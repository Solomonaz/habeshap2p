-- 0032 — admin reconciliation of stuck (SENDING) withdrawals
--
-- A withdrawal parks in SENDING when the signer claimed it but the bookkeeping
-- around the broadcast didn't complete (a DB blip / crash in the narrow window
-- right after sending). The row alone can't say whether the USDT actually left,
-- so the signer NEVER auto-resolves it — a human checks the chain and decides:
--
--   • the transfer DID land on-chain  → reconcile_sent  (debit the hold, mark SENT)
--   • the transfer never broadcast     → reconcile_refund (return the hold, mark FAILED)
--
-- These mirror withdrawal_mark_sent / withdrawal_mark_failed exactly, but are
-- ADMIN-gated (re-check is_admin, defence in depth like withdrawal_approve) and
-- only ever act on a SENDING row. They are the one-click resolution behind the
-- admin "mark sent / refund" buttons. The audit trail is written by the calling
-- server action (record_admin_action), same as approve/reject.

-- ── withdrawal_reconcile_sent: admin confirms the USDT left → settle as SENT ──
-- Requires the on-chain tx hash the admin verified on the explorer. Debits the
-- hold and writes the WITHDRAW ledger + OUT chain_txs row, just like the signer's
-- own mark_sent — so reconciliation lands in exactly the same end state.
create or replace function public.withdrawal_reconcile_sent(
  p_id      uuid,
  p_admin   uuid,
  p_tx_hash text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_w        public.withdrawals%rowtype;
begin
  select is_admin into v_is_admin from public.users where id = p_admin;
  if v_is_admin is not true then
    raise exception 'only an admin can reconcile a withdrawal';
  end if;
  if p_tx_hash is null or length(btrim(p_tx_hash)) = 0 then
    raise exception 'the on-chain tx hash is required to mark a withdrawal sent';
  end if;

  select * into v_w from public.withdrawals where id = p_id for update;
  if not found then raise exception 'withdrawal % not found', p_id; end if;
  if v_w.status <> 'SENDING' then
    raise exception 'withdrawal % is % — only a stuck (SENDING) withdrawal can be reconciled', p_id, v_w.status;
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

-- ── withdrawal_reconcile_refund: admin confirms it never sent → refund + FAIL ─
-- Returns the held funds to the user's available balance and marks the row FAILED,
-- exactly like the signer's mark_failed, but admin-initiated and only for a SENDING
-- row the admin has verified did NOT broadcast.
create or replace function public.withdrawal_reconcile_refund(
  p_id     uuid,
  p_admin  uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_w        public.withdrawals%rowtype;
begin
  select is_admin into v_is_admin from public.users where id = p_admin;
  if v_is_admin is not true then
    raise exception 'only an admin can reconcile a withdrawal';
  end if;

  select * into v_w from public.withdrawals where id = p_id for update;
  if not found then raise exception 'withdrawal % not found', p_id; end if;
  if v_w.status <> 'SENDING' then
    raise exception 'withdrawal % is % — only a stuck (SENDING) withdrawal can be reconciled', p_id, v_w.status;
  end if;

  perform 1 from public.wallets where user_id = v_w.user_id for update;
  update public.wallets
    set usdt_withdraw_locked = usdt_withdraw_locked - v_w.amount_usdt,
        usdt_available       = usdt_available + v_w.amount_usdt
    where user_id = v_w.user_id;

  insert into public.ledger_entries (user_id, type, amount_usdt)
    values (v_w.user_id, 'WITHDRAW_UNLOCK', v_w.amount_usdt);

  update public.withdrawals
    set status = 'FAILED',
        failure_reason = btrim(coalesce(nullif(p_reason, ''), 'Reconciled by admin: did not broadcast'))
    where id = p_id;
end;
$$;

-- ── withdrawal_stamp_send_tx: best-effort record of the broadcast hash ───────
-- When the signer broadcasts but the SENT bookkeeping fails, the row parks in
-- SENDING with no tx_hash. This lets the signer stamp the hash it got back onto
-- the parked row (scoped to SENDING so it can't disturb a settled row), so the
-- admin reconciliation screen shows it pre-filled. All table writes go through an
-- RPC by design (the withdrawals table has no client/route update path).
create or replace function public.withdrawal_stamp_send_tx(
  p_id      uuid,
  p_tx_hash text
) returns void
language sql
security definer
set search_path = public
as $$
  update public.withdrawals
    set tx_hash = btrim(p_tx_hash)
    where id = p_id and status = 'SENDING';
$$;

revoke all on function public.withdrawal_reconcile_sent(uuid, uuid, text) from public;
grant execute on function public.withdrawal_reconcile_sent(uuid, uuid, text) to service_role;
revoke all on function public.withdrawal_reconcile_refund(uuid, uuid, text) from public;
grant execute on function public.withdrawal_reconcile_refund(uuid, uuid, text) to service_role;
revoke all on function public.withdrawal_stamp_send_tx(uuid, text) from public;
grant execute on function public.withdrawal_stamp_send_tx(uuid, text) to service_role;
