-- 0035 — fix create_deposit_intent: round() type error in pooled mode
--
-- Migration 0029's create_deposit_intent computed the unique deposit amount with
--   round(p_base_amount + (floor(random() * 99999) + 1) / 1000000.0, 6)
-- random() is `double precision`, so the whole expression coerced to double, and
-- Postgres has no round(double precision, integer) — only round(numeric, integer).
-- In pooled sweep mode the user's "Get deposit details" call therefore failed with
-- "function round(double precision, integer) does not exist".
--
-- Fix: keep the random micro-suffix in integer/numeric so round() gets a numeric.
-- Behaviour is otherwise identical to 0029.

create or replace function public.create_deposit_intent(
  p_user        uuid,
  p_base_amount numeric
) returns public.deposit_intents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric(20, 6);
  v_row    public.deposit_intents%rowtype;
  v_try    integer := 0;
begin
  if p_base_amount is null or p_base_amount <= 0 then
    raise exception 'deposit base amount must be positive (got %)', p_base_amount;
  end if;

  perform public._expire_stale_intents();

  loop
    v_try := v_try + 1;
    if v_try > 50 then
      raise exception 'could not allocate a unique deposit amount, try again';
    end if;

    -- base + (1..99999) micros, rounded to 6dp. The suffix is built in integer →
    -- numeric so the argument to round() is numeric (not double precision).
    v_amount := round(
      p_base_amount + (floor(random() * 99999)::int + 1)::numeric / 1000000,
      6
    );

    if exists (
      select 1 from public.deposit_intents
      where amount_usdt = v_amount
        and (status = 'PENDING' or created_at > now() - interval '1 day')
    ) then
      continue;
    end if;

    begin
      insert into public.deposit_intents (user_id, amount_usdt, expires_at)
        values (p_user, v_amount, now() + interval '30 minutes')
        returning * into v_row;
      return v_row;
    exception when unique_violation then
      -- A concurrent PENDING intent grabbed this amount first — pick a new suffix.
      null;
    end;
  end loop;
end;
$$;
