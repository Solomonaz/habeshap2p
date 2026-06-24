-- 0028 — one open ad per side, per user (the user's explicit request)
--
-- Product rule: a user may have at most ONE live SELL ad and ONE live BUY ad at a
-- time. "Live" = not CLOSED (an ACTIVE or PAUSED ad still occupies the slot). To
-- post another on the same side they must close the existing one first.
--
-- This is the hard DB backstop. The server action (createAd) does a friendly
-- pre-check too, but this partial unique index is what actually guarantees the
-- invariant even against a race or a direct API insert.

-- ── 1. Reconcile existing data ───────────────────────────────────────────────
-- A partial unique index can't be created while duplicates exist. Close the
-- older non-CLOSED ads in each (user, side) group, keeping the most recent one
-- (newest created_at wins; id breaks ties deterministically).
with ranked as (
  select id,
         row_number() over (
           partition by user_id, side
           order by created_at desc, id desc
         ) as rn
  from public.ads
  where status <> 'CLOSED'
)
update public.ads a
  set status = 'CLOSED'
  from ranked r
  where a.id = r.id and r.rn > 1;

-- ── 2. Enforce the invariant going forward ───────────────────────────────────
-- Unique per (user_id, side) but only among non-CLOSED rows, so a user can still
-- close an ad and post a fresh one, and CLOSED history is unbounded.
create unique index if not exists ads_one_open_per_side
  on public.ads (user_id, side)
  where status <> 'CLOSED';
