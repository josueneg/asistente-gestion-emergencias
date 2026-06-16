// Edge Function: download-document
//
// Endpoint público que genera una URL firmada de descarga para el
// archivo original de un documento aprobado. La URL es válida 5 minutos.
// Solo funciona si el documento está aprobado y tiene un archivo subido.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { createSignedDownloadUrl } from "../_shared/storage.ts";

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  if (req.method !== "POST" && req.method !== "GET") {
    return jsonResponse({ error: "Método no permitido" }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let documentId: string | null = null;

  if (req.method === "GET") {
    const url = new URL(req.url);
    documentId = url.searchParams.get("document_id");
  } else {
    try {
      const body = await req.json();
      documentId = body.document_id ?? null;
    } catch {
      return jsonResponse({ error: "JSON inválido" }, 400);
    }
  }

  if (!documentId) {
    return jsonResponse({ error: "Falta 'document_id'" }, 400);
  }

  // Verificar que el documento esté aprobado y tenga archivo
  const { data: doc, error: docError } = await admin
    .from("documents")
    .select("id, filename, approval_status, storage_path, storage_size_bytes")
    .eq("id", documentId)
    .maybeSingle();

  if (docError || !doc) {
    return jsonResponse({ error: "Documento no encontrado" }, 404);
  }
  if (doc.approval_status !== "approved") {
    return jsonResponse({ error: "Documento no disponible" }, 403);
  }
  if (!doc.storage_path) {
    return jsonResponse(
      { error: "Este documento no tiene archivo descargable" },
      404,
    );
  }

  const url = await createSignedDownloadUrl(admin, doc.storage_path, 300);
  if (!url) {
    return jsonResponse(
      { error: "No se pudo generar el enlace de descarga" },
      500,
    );
  }

  return jsonResponse({
    url,
    filename: doc.filename,
    size_bytes: doc.storage_size_bytes ?? null,
  });
});
