-- 0014 — auth identity: email + Telegram, phone retired as a login method
--
-- Stage 1 of the auth rework. Phone OTP is being removed as a sign-in method
-- (SMS costs money); accounts are now keyed on email (native Supabase OTP) and,
-- in a later stage, Telegram. These columns are added now so the signup trigger
-- and profile reads are identity-source agnostic going forward. `phone` stays
-- for legacy rows but is no longer written by new signups.

alter table public.users
  add column if not exists full_name         text,
  add column if not exists email             text,
  add column if not exists telegram_id       bigint,
  add column if not exists telegram_username text;

-- Telegram ids are globally unique; enforce it so two profiles can't bind the
-- same Telegram account. NULLs are allowed (email-only users) and don't collide.
create unique index if not exists users_telegram_id_key
  on public.users (telegram_id)
  where telegram_id is not null;

-- ── auto-provision profile + wallet on signup (identity-agnostic) ─────────────
-- Supersedes the phone-only version from 0002. Copies whatever identity the auth
-- row carries: email for email signups, and the Telegram fields we stash in
-- raw_user_meta_data when minting a session from the Telegram callback (stage 3).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tg_id bigint;
begin
  -- Telegram id arrives as a string in user metadata; coerce defensively.
  begin
    v_tg_id := nullif(new.raw_user_meta_data ->> 'telegram_id', '')::bigint;
  exception when others then
    v_tg_id := null;
  end;

  insert into public.users (id, full_name, phone, email, telegram_id, telegram_username)
    values (
      new.id,
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      new.phone,
      new.email,
      v_tg_id,
      nullif(new.raw_user_meta_data ->> 'telegram_username', '')
    )
    on conflict (id) do nothing;

  insert into public.wallets (user_id)
    values (new.id)
    on conflict (user_id) do nothing;

  return new;
end;
$$;

-- ── guard the identity columns too ───────────────────────────────────────────
-- Identity is owned by auth.users (mirrored here by the trigger above). A client
-- must not be able to rewrite its own email/telegram binding via the profile row
-- and impersonate or hijack another account. Fold them into the existing guard.
create or replace function public.guard_users_protected_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    if new.reputation_score      is distinct from old.reputation_score
       or new.completed_trades    is distinct from old.completed_trades
       or new.completion_rate     is distinct from old.completion_rate
       or new.avg_release_seconds is distinct from old.avg_release_seconds
       or new.is_merchant         is distinct from old.is_merchant
       or new.is_admin            is distinct from old.is_admin
       or new.email               is distinct from old.email
       or new.telegram_id         is distinct from old.telegram_id
       or new.telegram_username   is distinct from old.telegram_username then
      raise exception 'Protected user columns can only be modified server-side';
    end if;
  end if;
  return new;
end;
$$;
