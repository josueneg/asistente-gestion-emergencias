// Edge Function: update-document
//
// Permite al admin editar los metadatos bibliográficos de un documento
// (título, fecha de publicación, instituciones, vigencia, fases del
// ciclo DRM, país, descripción) sin re-indexar ni tocar el RAG.
//
// También puede generar una URL firmada para que el admin suba/reemplace
// el archivo original en el Storage (request_upload_url=true).

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { isValidCountry } from "../_shared/countries.ts";
import { isValidPhase } from "../_shared/phases.ts";
import { createSignedUploadUrl } from "../_shared/storage.ts";

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Método no permitido" }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Verificar autenticación (personal del COE)
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    return jsonResponse({ error: "No autorizado" }, 401);
  }

  let payload: {
    document_id?: string;
    title?: string | null;
    publication_date?: string | null;
    institutions?: string | null;
    validity_start_year?: number | null;
    validity_end_year?: number | null;
    phases?: string[] | null;
    phase_other?: string | null;
    country_origin?: string | null;
    country_applicable?: string | null;
    description?: string | null;
    request_upload_url?: boolean;
    filename_for_upload?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "JSON inválido" }, 400);
  }

  const { document_id } = payload;
  if (!document_id) {
    return jsonResponse({ error: "Falta 'document_id'" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Validar países si se proporcionan
  if (payload.country_origin !== undefined && payload.country_origin !== null) {
    if (!isValidCountry(payload.country_origin)) {
      return jsonResponse({ error: "País de procedencia inválido" }, 400);
    }
  }
  if (
    payload.country_applicable !== undefined &&
    payload.country_applicable !== null &&
    payload.country_applicable !== ""
  ) {
    if (!isValidCountry(payload.country_applicable)) {
      return jsonResponse({ error: "País al que aplica inválido" }, 400);
    }
  }

  // Validar fases si se proporcionan
  let phases: string[] | null = null;
  if (payload.phases !== undefined) {
    phases = payload.phases === null
      ? null
      : (payload.phases as string[]).filter((p) => isValidPhase(p));
  }

  // Construir el objeto de actualización con solo los campos provistos
  const updates: Record<string, unknown> = {};

  if ("title" in payload) updates.title = payload.title?.trim() || null;
  if ("publication_date" in payload) {
    updates.publication_date = payload.publication_date || null;
  }
  if ("institutions" in payload) {
    updates.institutions = payload.institutions?.trim() || null;
  }
  if ("validity_start_year" in payload) {
    updates.validity_start_year = payload.validity_start_year ?? null;
  }
  if ("validity_end_year" in payload) {
    updates.validity_end_year = payload.validity_end_year ?? null;
  }
  if ("phases" in payload) updates.phases = phases;
  if ("phase_other" in payload) {
    updates.phase_other = payload.phase_other?.trim() || null;
  }
  if ("country_origin" in payload) {
    updates.country_origin = payload.country_origin?.trim() || null;
  }
  if ("country_applicable" in payload) {
    updates.country_applicable = payload.country_applicable?.trim() || null;
  }
  if ("description" in payload) {
    updates.description = payload.description?.trim() || null;
  }

  if (Object.keys(updates).length > 0) {
    const { error: updateError } = await admin
      .from("documents")
      .update(updates)
      .eq("id", document_id);

    if (updateError) {
      return jsonResponse(
        { error: `Error al actualizar: ${updateError.message}` },
        500,
      );
    }
  }

  // Generar URL firmada de subida si se solicita
  let uploadUrl: string | null = null;
  if (payload.request_upload_url && payload.filename_for_upload) {
    uploadUrl = await createSignedUploadUrl(
      admin,
      document_id,
      payload.filename_for_upload,
    );
    if (uploadUrl) {
      const { documentStoragePath } = await import("../_shared/storage.ts");
      const newPath = documentStoragePath(document_id, payload.filename_for_upload);
      await admin
        .from("documents")
        .update({ storage_path: newPath })
        .eq("id", document_id);
    }
  }

  return jsonResponse({ ok: true, upload_url: uploadUrl });
});
