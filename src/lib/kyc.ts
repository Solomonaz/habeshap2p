import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/server";
import type { Database, KycStatus } from "@/lib/supabase/database.types";

export type KycSubmissionRow =
  Database["public"]["Tables"]["kyc_submissions"]["Row"];

const KYC_BUCKET = "kyc";
const KYC_COLUMNS =
  "id, user_id, id_document_path, id_document_back_path, liveness_path, full_name, id_number, status, rejection_reason, reviewed_by, reviewed_at, created_at";

/**
 * Identity verification (Stage 2). A user uploads a government ID + a liveness
 * selfie to the private `kyc` bucket, then files a submission; an admin reviews
 * it by hand. The user's `kyc_status` mirrors the latest decision, and the
 * database triggers in migration 0015 hard-block trading until it is APPROVED.
 *
 * All state transitions run through the SECURITY DEFINER RPCs (kyc_submit /
 * kyc_approve / kyc_reject), invoked via the service-role client but passing the
 * authenticated user/admin id — the SQL re-checks authority, so it is enforced
 * in the database, not merely trusted here.
 */

/** File a submission. Account moves to PENDING. Returns the new submission id. */
export async function submitKyc(args: {
  userId: string;
  idDocumentPath: string;
  idDocumentBackPath: string;
  livenessPath: string;
  fullName: string;
  idNumber: string;
}): Promise<string> {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase.rpc("kyc_submit", {
    p_user: args.userId,
    p_id_document: args.idDocumentPath,
    p_id_document_back: args.idDocumentBackPath,
    p_liveness: args.livenessPath,
    p_full_name: args.fullName,
    p_id_number: args.idNumber,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("kyc_submit returned no id");
  return data;
}

/** Admin clears a pending submission; the account becomes APPROVED. */
export async function approveKyc(id: string, adminId: string): Promise<void> {
  const supabase = createAdminSupabase();
  const { error } = await supabase.rpc("kyc_approve", {
    p_id: id,
    p_admin: adminId,
  });
  if (error) throw new Error(error.message);
}

/** Admin denies a pending submission; the user may resubmit. */
export async function rejectKyc(
  id: string,
  adminId: string,
  reason: string,
): Promise<void> {
  const supabase = createAdminSupabase();
  const { error } = await supabase.rpc("kyc_reject", {
    p_id: id,
    p_admin: adminId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

/** The caller's current verification status (RLS session client). */
export async function fetchKycStatus(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<KycStatus> {
  const { data, error } = await supabase
    .from("users")
    .select("kyc_status")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`failed to load verification status: ${error.message}`);
  return (data?.kyc_status ?? "UNVERIFIED") as KycStatus;
}

/**
 * The caller's most recent submission (RLS session client), or null if they have
 * never submitted. Used to surface a rejection reason on the /verify page.
 */
export async function fetchLatestSubmission(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<KycSubmissionRow | null> {
  const { data, error } = await supabase
    .from("kyc_submissions")
    .select(KYC_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`failed to load submission: ${error.message}`);
  return (data as KycSubmissionRow | null) ?? null;
}

/**
 * Admin review queue: submissions awaiting a decision (service-role read; the
 * caller must have already verified the user is an admin), oldest first.
 */
export async function fetchPendingKyc(): Promise<KycSubmissionRow[]> {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from("kyc_submissions")
    .select(KYC_COLUMNS)
    .eq("status", "PENDING")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`failed to load verification queue: ${error.message}`);
  return (data ?? []) as KycSubmissionRow[];
}

/**
 * The set of ID numbers that are ALREADY verified (APPROVED) on some account. The
 * admin queue uses this to flag a pending submission whose ID number is already
 * verified elsewhere — approving it would be blocked by kyc_approve anyway, but
 * the warning lets the reviewer reject the duplicate up front. Service-role read.
 */
export async function fetchApprovedIdNumbers(): Promise<Set<string>> {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from("kyc_submissions")
    .select("id_number")
    .eq("status", "APPROVED")
    .not("id_number", "is", null);
  if (error) {
    console.error(`[kyc] failed to load approved id numbers: ${error.message}`);
    return new Set();
  }
  return new Set(
    (data ?? [])
      .map((r) => (r as { id_number: string | null }).id_number)
      .filter((n): n is string => !!n),
  );
}

/**
 * Uploads a KYC image to the private bucket under the user's path prefix
 * (`<userId>/<random>.<ext>`), which the storage RLS policies key off. Runs on
 * the user's session client. Returns the stored object path.
 */
export async function uploadKycImage(
  supabase: SupabaseClient<Database>,
  userId: string,
  file: File,
): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(KYC_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(`upload failed: ${error.message}`);
  return path;
}

/** Mints a short-lived signed URL for a stored KYC object path. */
export async function signedKycUrl(
  supabase: SupabaseClient<Database>,
  path: string,
  expiresInSeconds = 600,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(KYC_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) return null;
  return data.signedUrl;
}
