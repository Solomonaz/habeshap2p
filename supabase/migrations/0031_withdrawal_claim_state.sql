-- 0031 — withdrawal SENDING claim state: at-most-once on-chain payout
--
-- The signer used to read every APPROVED row and broadcast it, marking SENT only
-- afterwards. Two latent money bugs lived in that gap:
--
--   1. Concurrency — two overlapping cron runs both read the same APPROVED row
--      (neither has marked it SENT yet) and BOTH broadcast it → the user is paid
--      twice. (A lease lock helps but can't cover a crash between broadcast and
--      mark_sent: the lease expires and the next run re-broadcasts.)
--   2. Refund-after-send — if the broadcast SUCCEEDS but mark_sent then errors,
--      the old signer treated it as a failure and REFUNDED the held funds, even
--      though the USDT already left the hot wallet on-chain. Pure loss, logged as
--      an ordinary "FAILED".
--
-- The fix is a CLAIM state. The signer must atomically move APPROVED → SENDING
-- BEFORE it broadcasts; only the runner that wins the claim proceeds. After that:
--   • broadcast succeeds → SENDING → SENT (funds debited, as before).
--   • broadcast THROWS (funds never left) → SENDING → FAILED (refund) — safe.
--   • broadcast succeeds but bookkeeping fails → the row STAYS in SENDING and is
--     parked for manual reconciliation. It is never auto-retried (that would
--     double-send) and never auto-refunded (the funds are gone).
--
-- A row in SENDING therefore means "claimed by the signer; in-flight or awaiting a
-- human" — the next run's `where status = 'APPROVED'` deliberately skips it.

-- The new function bodies reference the new 'SENDING' enum label. A label added by
-- `alter type ... add value` is not usable in the SAME transaction, and CREATE
-- FUNCTION would normally validate the body and choke on it — so disable body
-- validation for this migration (same pattern as 0027). The labels resolve fine at
-- runtime, after this migration commits.
set check_function_bodies = off;

-- ── 1. the claim state ───────────────────────────────────────────────────────
alter type withdrawal_status add value if not exists 'SENDING' after 'APPROVED';

-- ── 2. withdrawal_claim_for_send: atomically claim an APPROVED row to send ────
-- Returns true iff THIS caller moved the row APPROVED → SENDING. The `for update`
-- row lock serializes concurrent claimants, so a row already taken (or no longer
-- APPROVED) yields false and the caller must skip it — never broadcast it. No money
-- moves here; the hold stays put until mark_sent (debit) or mark_failed (refund).
create or replace function public.withdrawal_claim_for_send(
  p_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status withdrawal_status;
begin
  select status into v_status from public.withdrawals where id = p_id for update;
  if not found then
    raise exception 'withdrawal % not found', p_id;
  end if;
  -- Only an APPROVED row can be claimed. Anything else (already SENDING/SENT by a
  -- concurrent run, or rejected/failed) is not ours to send.
  if v_status <> 'APPROVED' then
    return false;
  end if;
  update public.withdrawals set status = 'SENDING' where id = p_id;
  return true;
end;
$$;

-- ── 3. withdrawal_mark_sent: now settles a CLAIMED (SENDING) row ──────────────
-- Called only after a successful broadcast of a claimed withdrawal. This is the
-- point the funds actually leave, so the hold is debited (not refunded) and a
-- WITHDRAW ledger line + an OUT chain_txs row are written for reconciliation.
create or replace function public.withdrawal_mark_sent(
  p_id      uuid,
  p_tx_hash text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_w public.withdrawals%rowtype;
begin
  if p_tx_hash is null or length(btrim(p_tx_hash)) = 0 then
    raise exception 'tx hash is required to mark sent';
  end if;

  select * into v_w from public.withdrawals where id = p_id for update;
  if not found then raise exception 'withdrawal % not found', p_id; end if;
  -- Must be a claimed row. Guarding on SENDING (not APPROVED) means an unclaimed
  -- row can never be marked sent, and a double mark_sent on an already-SENT row is
  -- rejected rather than double-debiting.
  if v_w.status <> 'SENDING' then
    raise exception 'withdrawal % is % — not claimed for sending', p_id, v_w.status;
  end if;

  perform 1 from public.wallets where user_id = v_w.user_id for update;
  update public.wallets
    set usdt_withdraw_locked = usdt_withdraw_locked - v_w.amount_usdt
    where user_id = v_w.user_id;

  insert into public.ledger_entries (user_id, type, amount_usdt)
    values (v_w.user_id, 'WITHDRAW', v_w.amount_usdt);

  insert into public.chain_txs (user_id, direction, tx_hash, amount_usdt, confirmed)
    values (v_w.user_id, 'OUT', btrim(p_tx_hash), v_w.amount_usdt, false);

  update public.withdrawals
    set status = 'SENT', tx_hash = btrim(p_tx_hash), sent_at = now()
    where id = p_id;
end;
$$;

-- ── 4. withdrawal_mark_failed: refund a claimed row whose broadcast FAILED ────
-- Called ONLY when the broadcast itself threw — i.e. the funds never left — so the
-- hold can be safely returned. Guards on SENDING: the signer claims before
-- broadcasting, so a failed broadcast leaves the row in SENDING, and a row that
-- already reached SENT (funds gone) can never be refunded here.
create or replace function public.withdrawal_mark_failed(
  p_id     uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_w public.withdrawals%rowtype;
begin
  select * into v_w from public.withdrawals where id = p_id for update;
  if not found then raise exception 'withdrawal % not found', p_id; end if;
  if v_w.status <> 'SENDING' then
    raise exception 'withdrawal % is % — only a claimed (SENDING) withdrawal whose broadcast failed can be refunded', p_id, v_w.status;
  end if;

  perform 1 from public.wallets where user_id = v_w.user_id for update;
  update public.wallets
    set usdt_withdraw_locked = usdt_withdraw_locked - v_w.amount_usdt,
        usdt_available       = usdt_available + v_w.amount_usdt
    where user_id = v_w.user_id;

  insert into public.ledger_entries (user_id, type, amount_usdt)
    values (v_w.user_id, 'WITHDRAW_UNLOCK', v_w.amount_usdt);

  update public.withdrawals
    set status = 'FAILED', failure_reason = btrim(coalesce(p_reason, ''))
    where id = p_id;
end;
$$;

revoke all on function public.withdrawal_claim_for_send(uuid) from public;
grant execute on function public.withdrawal_claim_for_send(uuid) to service_role;
