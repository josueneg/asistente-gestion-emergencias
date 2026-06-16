import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "documents";

export function documentStoragePath(documentId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._\-]/g, "_");
  return `${documentId}/${safe}`;
}

export async function createSignedUploadUrl(
  admin: SupabaseClient,
  documentId: string,
  filename: string,
): Promise<string | null> {
  const path = documentStoragePath(documentId, filename);
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { upsert: true });
  if (error || !data?.signedUrl) {
    console.error("Error creando signed upload URL:", error);
    return null;
  }
  return data.signedUrl;
}

export async function createSignedDownloadUrl(
  admin: SupabaseClient,
  storagePath: string,
  ttlSeconds = 300,
): Promise<string | null> {
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, ttlSeconds);
  if (error || !data?.signedUrl) {
    console.error("Error creando signed download URL:", error);
    return null;
  }
  return data.signedUrl;
}
