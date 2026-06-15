// Edge Function: ingest-document
//
// Recibe el texto YA EXTRAÍDO de un documento (PDF/Word/Excel se
// parsean en el navegador, ver admin/admin.js), lo divide en
// fragmentos, genera sus embeddings con Gemini y los guarda en
// la base vectorial para que "chat" pueda usarlos (RAG).
//
// Requiere que quien llama esté autenticado (personal del COE).
// Las subidas hechas desde el panel admin se consideran aprobadas
// de entrada (a diferencia de las enviadas por el público vía
// "submit-document", que quedan pendientes de revisión).

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { indexDocumentChunks } from "../_shared/index-document.ts";
import { isValidCountry } from "../_shared/countries.ts";

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Método no permitido" }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 1. Verificar que quien llama está autenticado (personal del COE)
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    return jsonResponse({ error: "No autorizado" }, 401);
  }

  // 2. Leer el documento enviado
  let payload: {
    filename?: string;
    mime_type?: string;
    text?: string;
    country_origin?: string;
    country_applicable?: string;
    description?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "JSON inválido" }, 400);
  }

  const { filename, mime_type, text, description } = payload;
  if (!filename || !text || text.trim().length === 0) {
    return jsonResponse({ error: "Faltan 'filename' o 'text'" }, 400);
  }

  const countryOrigin = payload.country_origin?.trim() || null;
  if (countryOrigin && !isValidCountry(countryOrigin)) {
    return jsonResponse({ error: "País de procedencia inválido" }, 400);
  }
  const countryApplicable = payload.country_applicable?.trim() || null;
  if (countryApplicable && !isValidCountry(countryApplicable)) {
    return jsonResponse({ error: "País al que aplica inválido" }, 400);
  }

  // 3. Cliente con privilegios para escribir en la base de datos
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: doc, error: insertError } = await admin
    .from("documents")
    .insert({
      filename,
      mime_type: mime_type ?? null,
      status: "pending",
      approval_status: "approved",
      char_count: text.length,
      uploaded_by: userData.user.id,
      country_origin: countryOrigin,
      country_applicable: countryApplicable,
      description: description?.trim() || null,
      raw_text: text,
    })
    .select()
    .single();

  if (insertError || !doc) {
    return jsonResponse(
      { error: `No se pudo crear el documento: ${insertError?.message}` },
      500,
    );
  }

  // 4. Dividir en fragmentos y generar embeddings
  try {
    const chunks = await indexDocumentChunks(admin, doc.id, text);
    await admin.from("documents").update({ status: "indexed" }).eq("id", doc.id);
    return jsonResponse({ document_id: doc.id, chunks });
  } catch (err) {
    await admin
      .from("documents")
      .update({ status: "error", error_message: String(err) })
      .eq("id", doc.id);
    return jsonResponse({ error: `Fallo al indexar: ${err}` }, 500);
  }
});
