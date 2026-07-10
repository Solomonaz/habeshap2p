-- 0060 — admin-configurable withdrawal approval threshold
--
-- Withdrawals whose TOTAL (amount + fee) is at or above a threshold need an admin
-- to approve before the signer broadcasts them; below it they auto-approve. That
-- threshold used to be a deploy-time env var (WITHDRAWAL_APPROVAL_THRESHOLD), which
-- an operator can't change without a redeploy. As the platform grows and larger
-- legitimate withdrawals become routine, the admin needs to raise (or lower) it
-- from the console. This moves the value into platform_settings, written only
-- through set_withdrawal_approval_threshold (re-checks is_admin — same pattern as
-- the withdrawal fee in 0045). withdrawal_request already takes the threshold as a
-- parameter, so the caller just passes this value instead of the env constant.

alter table public.platform_settings
  add column if not exists withdrawal_approval_threshold numeric(20, 6) not null
    default 500 check (withdrawal_approval_threshold >= 0);

comment on column public.platform_settings.withdrawal_approval_threshold is
  'Withdrawals with amount + fee >= this (USDT) require admin approval; below it '
  'they auto-approve. 0 means every withdrawal needs approval.';

create or replace function public.set_withdrawal_approval_threshold(
  p_admin     uuid,
  p_threshold numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
begin
  select is_admin into v_is_admin from public.users where id = p_admin;
  if v_is_admin is not true then
    raise exception 'only an admin can change the withdrawal approval threshold';
  end if;
  if p_threshold is null or p_threshold < 0 then
    raise exception 'approval threshold must be zero or positive (got %)', p_threshold;
  end if;

  insert into public.platform_settings (id, withdrawal_approval_threshold, updated_by, updated_at)
    values (true, p_threshold, p_admin, now())
    on conflict (id) do update
      set withdrawal_approval_threshold = excluded.withdrawal_approval_threshold,
          updated_by                    = excluded.updated_by,
          updated_at                    = excluded.updated_at;
end;
$$;

revoke all on function public.set_withdrawal_approval_threshold(uuid, numeric) from public;
grant execute on function public.set_withdrawal_approval_threshold(uuid, numeric) to service_role;
