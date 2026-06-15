// Edge Function: approve-document
//
// Requiere autenticación (personal del COE). Aprueba un documento
// pendiente: lo indexa (chunking + embeddings, igual que
// "ingest-document") para que "chat" pueda usarlo, y notifica por
// correo a quien lo envió si dejó su email.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { indexDocumentChunks } from "../_shared/index-document.ts";
import { escapeHtml, sendEmail } from "../_shared/email.ts";

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

  let payload: { document_id?: string };
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

  const { data: doc, error: docError } = await admin
    .from("documents")
    .select("id, filename, raw_text, approval_status")
    .eq("id", document_id)
    .maybeSingle();

  if (docError || !doc) {
    return jsonResponse({ error: "Documento no encontrado" }, 404);
  }
  if (doc.approval_status !== "pending") {
    return jsonResponse({ error: "El documento ya fue revisado" }, 400);
  }
  if (!doc.raw_text || doc.raw_text.trim().length === 0) {
    return jsonResponse(
      { error: "El documento no tiene texto para indexar" },
      400,
    );
  }

  // 2. Dividir en fragmentos y generar embeddings (igual que ingest-document)
  let chunks: number;
  try {
    chunks = await indexDocumentChunks(admin, doc.id, doc.raw_text);
  } catch (err) {
    await admin
      .from("documents")
      .update({ status: "error", error_message: String(err) })
      .eq("id", doc.id);
    return jsonResponse({ error: `Fallo al indexar: ${err}` }, 500);
  }

  await admin
    .from("documents")
    .update({
      approval_status: "approved",
      status: "indexed",
      reviewed_at: new Date().toISOString(),
      reviewed_by: userData.user.id,
    })
    .eq("id", doc.id);

  // 3. Notificar a quien lo envió, si dejó su correo
  const { data: submission } = await admin
    .from("document_submissions")
    .select("id, submitter_name, submitter_email")
    .eq("document_id", doc.id)
    .maybeSingle();

  if (submission?.submitter_email) {
    const name = submission.submitter_name
      ? escapeHtml(submission.submitter_name)
      : "";
    await sendEmail(
      submission.submitter_email,
      submission.submitter_name,
      "Tu documento fue aprobado",
      `<p>Hola${name ? " " + name : ""},</p>
<p>Tu documento <strong>${escapeHtml(doc.filename)}</strong> fue revisado y
<strong>aprobado</strong>. Ya forma parte de la biblioteca del Asistente de Gestión de
Emergencias y el sistema lo está usando para responder preguntas y generar
recomendaciones.</p>
<p>¡Gracias por tu aporte!</p>`,
    );
    await admin
      .from("document_submissions")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", submission.id);
  }

  return jsonResponse({ ok: true, chunks });
});
