-- 0038 — capture the BACK of the ID document in KYC
--
-- Identity submissions previously stored only the front of the ID + a liveness
-- selfie. Most national IDs (incl. the Ethiopian Fayda) carry essential detail on
-- the back, so we now capture both sides. Existing rows keep a null back path; new
-- submissions require it (kyc_submit gains a p_id_document_back argument).

alter table public.kyc_submissions
  add column if not exists id_document_back_path text;

-- Replace kyc_submit with the 5-arg version. Drop the old 4-arg form so there's no
-- ambiguous overload; the app always sends the back now.
drop function if exists public.kyc_submit(uuid, text, text, text);

create or replace function public.kyc_submit(
  p_user             uuid,
  p_id_document      text,
  p_id_document_back text,
  p_liveness         text,
  p_full_name        text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status kyc_status;
  v_id     uuid;
begin
  if p_id_document is null or length(btrim(p_id_document)) = 0 then
    raise exception 'front of ID is required';
  end if;
  if p_id_document_back is null or length(btrim(p_id_document_back)) = 0 then
    raise exception 'back of ID is required';
  end if;
  if p_liveness is null or length(btrim(p_liveness)) = 0 then
    raise exception 'liveness photo is required';
  end if;
  if p_full_name is null or length(btrim(p_full_name)) < 2 then
    raise exception 'full name is required';
  end if;

  select kyc_status into v_status from public.users where id = p_user for update;
  if not found then
    raise exception 'user % not found', p_user;
  end if;
  if v_status = 'APPROVED' then
    raise exception 'account is already verified';
  end if;
  if v_status = 'PENDING' then
    raise exception 'a verification request is already under review';
  end if;

  insert into public.kyc_submissions
      (user_id, id_document_path, id_document_back_path, liveness_path, full_name)
    values (
      p_user, btrim(p_id_document), btrim(p_id_document_back),
      btrim(p_liveness), btrim(p_full_name)
    )
    returning id into v_id;

  update public.users set kyc_status = 'PENDING' where id = p_user;

  return v_id;
end;
$$;

revoke all on function public.kyc_submit(uuid, text, text, text, text) from public;
grant execute on function public.kyc_submit(uuid, text, text, text, text) to service_role;
