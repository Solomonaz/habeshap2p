-- ── chain_txs: make uniqueness per-direction, not global on tx_hash ──────────
--
-- A single on-chain transaction can legitimately be BOTH an outbound row (the
-- sender's withdrawal) and an inbound row (the recipient's deposit). That happens
-- whenever a platform withdrawal is sent to an address we track as a deposit
-- address — e.g. a user withdrawing to their own deposit address, or a withdrawal
-- whose destination is another user's deposit address.
--
-- Previously `chain_txs.tx_hash` was GLOBALLY unique, so the deposit poller's
-- `credit_deposit` insert (direction = 'IN') collided with the already-recorded
-- withdrawal row (direction = 'OUT') under the same hash. The ON CONFLICT then
-- swallowed the insert and the recipient was SILENTLY never credited — a money
-- bug, not just a test-mode quirk.
--
-- Fix: uniqueness is on (direction, tx_hash). Deposit idempotency is preserved —
-- re-polling the same inbound transfer still conflicts on ('IN', tx_hash), so a
-- user is still credited exactly once. Withdrawal hashes are unique anyway.

alter table public.chain_txs
  drop constraint if exists chain_txs_tx_hash_key;

alter table public.chain_txs
  add constraint chain_txs_direction_tx_hash_key unique (direction, tx_hash);

-- Update credit_deposit's conflict target to match the new constraint.
create or replace function public.credit_deposit(
  p_user   uuid,
  p_tx_hash text,
  p_amount numeric
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'deposit amount must be positive (got %)', p_amount;
  end if;
  if p_tx_hash is null or length(btrim(p_tx_hash)) = 0 then
    raise exception 'tx hash is required';
  end if;

  insert into public.chain_txs (user_id, direction, tx_hash, amount_usdt, confirmed)
    values (p_user, 'IN', btrim(p_tx_hash), p_amount, true)
    on conflict (direction, tx_hash) do nothing;
  if not found then
    return false;            -- already credited on a previous poll
  end if;

  perform public.ledger_deposit(p_user, p_amount);
  return true;
end;
$$;

revoke all on function public.credit_deposit(uuid, text, numeric) from public;
grant execute on function public.credit_deposit(uuid, text, numeric) to service_role;
