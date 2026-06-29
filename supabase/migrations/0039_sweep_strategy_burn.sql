-- 0039 — add 'burn' as a 4th sweep strategy
--
-- staking/rental/pooled already exist (0029). 'burn' re-introduces the pay-as-you-go
-- model: the sweeper sends a deposit address just enough TRX to be burned as Energy
-- when it forwards its USDT to the hot wallet. No stake locked, no rental provider —
-- the TRX is spent as gas. Widen the check constraint and the admin RPC's validation.

-- Drop whatever check constraint currently restricts sweep_strategy (robust to its
-- auto-generated name), then re-add it with 'burn' included.
do $$
declare
  c text;
begin
  for c in
    select conname
      from pg_constraint
      where conrelid = 'public.platform_settings'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%sweep_strategy%'
  loop
    execute format('alter table public.platform_settings drop constraint %I', c);
  end loop;
end $$;

alter table public.platform_settings
  add constraint platform_settings_sweep_strategy_check
  check (sweep_strategy in ('staking', 'rental', 'burn', 'pooled'));

-- set_sweep_strategy: same as 0029 but accepts 'burn'. The pooled→non-pooled guard
-- (refuse while live deposit intents exist) is unchanged and applies to 'burn' too.
create or replace function public.set_sweep_strategy(
  p_admin          uuid,
  p_strategy       text,
  p_pooled_address text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_current  text;
  v_pooled   text;
begin
  select is_admin into v_is_admin from public.users where id = p_admin;
  if v_is_admin is not true then
    raise exception 'only an admin can change the sweep strategy';
  end if;

  if p_strategy is null or p_strategy not in ('staking', 'rental', 'burn', 'pooled') then
    raise exception 'invalid sweep strategy: %', p_strategy;
  end if;

  select sweep_strategy into v_current from public.platform_settings where id = true;
  if v_current = 'pooled' and p_strategy <> 'pooled' then
    if exists (
      select 1 from public.deposit_intents
      where status = 'PENDING' and expires_at > now()
    ) then
      raise exception
        'cannot switch off pooled mode while deposit intents are still pending; '
        'wait for them to be paid or to expire, then change the strategy';
    end if;
  end if;

  v_pooled := nullif(btrim(coalesce(p_pooled_address, '')), '');

  insert into public.platform_settings (id, sweep_strategy, pooled_deposit_address, updated_by, updated_at)
    values (true, p_strategy, v_pooled, p_admin, now())
    on conflict (id) do update
      set sweep_strategy         = excluded.sweep_strategy,
          pooled_deposit_address = excluded.pooled_deposit_address,
          updated_by             = excluded.updated_by,
          updated_at             = excluded.updated_at;
end;
$$;

revoke all on function public.set_sweep_strategy(uuid, text, text) from public;
grant execute on function public.set_sweep_strategy(uuid, text, text) to service_role;
