-- 0052 — multiple receiving accounts per SELL ad
--
-- A SELL advertiser can now accept several payment rails, each with its own
-- account. We store them as a JSONB array on the ad:
--   [{"method":"TELEBIRR","name":"…","number":"…","note":"…"}, …]
-- When a buyer takes the ad they pick ONE method; order_create snapshots that
-- method's account onto the order (same order columns as before). Ads created
-- before this migration keep working: if receiving_accounts is null we fall back
-- to the legacy single receiving_* columns.

alter table public.ads
  add column if not exists receiving_accounts jsonb;

-- ── order_create: snapshot the CHOSEN method's account ────────────────────────
-- Identical to 0047 except the SELL branch resolves the receiving account for
-- p_payment_method out of the per-method list (fallback to the legacy columns).
create or replace function public.order_create(
  p_ad uuid,
  p_taker uuid,
  p_amount_usdt numeric,
  p_payment_method payment_method,
  p_buyer_payment_name text,
  p_ttl_minutes integer default null,
  p_receiving_name text default null,
  p_receiving_number text default null,
  p_receiving_note text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ad           public.ads%rowtype;
  v_buyer        uuid;
  v_seller       uuid;
  v_amount_etb   numeric(20, 2);
  v_payer_name   text;
  v_order        uuid;
  v_buyer_cap    numeric;
  v_seller_cap   numeric;
  v_ttl          integer;
  v_taker_status text;
  v_owner_status text;
  v_rname        text;
  v_rnum         text;
  v_rnote        text;
begin
  if p_amount_usdt is null or p_amount_usdt <= 0 then
    raise exception 'order amount must be positive (got %)', p_amount_usdt;
  end if;

  select * into v_ad from public.ads where id = p_ad for update;
  if not found then
    raise exception 'ad % not found', p_ad;
  end if;
  if v_ad.status <> 'ACTIVE' then
    raise exception 'ad % is not active', p_ad;
  end if;
  if v_ad.user_id = p_taker then
    raise exception 'cannot take your own ad';
  end if;
  if not (p_payment_method = any (v_ad.payment_methods)) then
    raise exception 'payment method % not offered on this ad', p_payment_method;
  end if;

  -- Account-standing guard: neither party may be frozen or banned.
  select account_status into v_taker_status from public.users where id = p_taker;
  if coalesce(v_taker_status, 'ACTIVE') <> 'ACTIVE' then
    raise exception 'your account is % — you cannot trade', v_taker_status;
  end if;
  select account_status into v_owner_status from public.users where id = v_ad.user_id;
  if coalesce(v_owner_status, 'ACTIVE') <> 'ACTIVE' then
    raise exception 'the advertiser''s account is not active — this ad cannot be taken';
  end if;

  -- Parties + the receiver's account depend on which side the advertiser is on.
  if v_ad.side = 'SELL' then          -- advertiser sells USDT -> taker buys
    v_seller := v_ad.user_id;
    v_buyer  := p_taker;
    v_payer_name := p_buyer_payment_name;     -- taker (buyer) supplies it
    -- Receiver = advertiser: pick the account for the chosen method from the
    -- per-method list (0052); fall back to the legacy single columns.
    if v_ad.receiving_accounts is not null then
      select nullif(btrim(coalesce(elem ->> 'name',   '')), ''),
             nullif(btrim(coalesce(elem ->> 'number', '')), ''),
             nullif(btrim(coalesce(elem ->> 'note',   '')), '')
        into v_rname, v_rnum, v_rnote
        from jsonb_array_elements(v_ad.receiving_accounts) as elem
        where elem ->> 'method' = p_payment_method::text
        limit 1;
    else
      v_rname := nullif(btrim(coalesce(v_ad.receiving_name, '')), '');
      v_rnum  := nullif(btrim(coalesce(v_ad.receiving_number, '')), '');
      v_rnote := nullif(btrim(coalesce(v_ad.receiving_note, '')), '');
    end if;
  else                                 -- BUY ad: advertiser buys -> taker sells
    v_seller := p_taker;
    v_buyer  := v_ad.user_id;
    v_payer_name := v_ad.payer_name;          -- advertiser (buyer) supplied it
    -- Receiver = taker (seller): they supply their account now.
    v_rname := nullif(btrim(coalesce(p_receiving_name, '')), '');
    v_rnum  := nullif(btrim(coalesce(p_receiving_number, '')), '');
    v_rnote := nullif(btrim(coalesce(p_receiving_note, '')), '');
    if v_rname is null or v_rnum is null then
      raise exception 'enter the account where the buyer should pay you (name + number)';
    end if;
  end if;

  if v_payer_name is null or length(btrim(v_payer_name)) = 0 then
    raise exception 'buyer payment name is required';
  end if;

  -- Trade-limit guard (rule #5). Both parties must be within their per-order cap;
  -- a null cap means a bonded merchant with no limit.
  v_buyer_cap  := public._trade_limit_usdt(v_buyer);
  v_seller_cap := public._trade_limit_usdt(v_seller);
  if v_buyer_cap is not null and p_amount_usdt > v_buyer_cap then
    raise exception 'order amount % USDT exceeds the buyer trade limit of % USDT (post a merchant bond to lift it)',
      p_amount_usdt, v_buyer_cap;
  end if;
  if v_seller_cap is not null and p_amount_usdt > v_seller_cap then
    raise exception 'order amount % USDT exceeds the seller trade limit of % USDT (post a merchant bond to lift it)',
      p_amount_usdt, v_seller_cap;
  end if;

  v_amount_etb := round(p_amount_usdt * v_ad.rate_etb, 2);
  if v_amount_etb < v_ad.min_etb or v_amount_etb > v_ad.max_etb then
    raise exception 'order value % ETB is outside ad limits %–% ETB',
      v_amount_etb, v_ad.min_etb, v_ad.max_etb;
  end if;

  -- Resolve the payment window: an explicit p_ttl_minutes wins; otherwise read
  -- the admin-configured order_ttl_minutes (fail safe to 15 if no row).
  if p_ttl_minutes is not null then
    v_ttl := p_ttl_minutes;
  else
    select order_ttl_minutes into v_ttl from public.platform_settings where id;
    v_ttl := coalesce(v_ttl, 15);
  end if;

  -- Insert the order first so the lock's ledger entry carries the order id.
  insert into public.orders (
    ad_id, buyer_id, seller_id, amount_usdt, rate_etb, amount_etb,
    payment_method, buyer_payment_name, expires_at,
    receiving_name, receiving_number, receiving_note
  ) values (
    p_ad, v_buyer, v_seller, p_amount_usdt, v_ad.rate_etb, v_amount_etb,
    p_payment_method, btrim(v_payer_name),
    now() + make_interval(mins => greatest(v_ttl, 1)),
    v_rname, v_rnum, v_rnote
  )
  returning id into v_order;

  -- Lock the seller's escrow (available -> locked) against the new order.
  perform public.ledger_lock(v_seller, p_amount_usdt, v_order);

  return v_order;
end;
$$;
