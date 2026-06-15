// Edge Function: reject-document
//
// Requiere autenticación (personal del COE). Rechaza un documento
// pendiente: lo elimina por completo (incl. cualquier fragmento ya
// indexado) y notifica por correo a quien lo envió si dejó su email.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";
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

  let payload: { document_id?: string; reason?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "JSON inválido" }, 400);
  }

  const { document_id, reason } = payload;
  if (!document_id) {
    return jsonResponse({ error: "Falta 'document_id'" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: doc, error: docError } = await admin
    .from("documents")
    .select("id, filename")
    .eq("id", document_id)
    .maybeSingle();

  if (docError || !doc) {
    return jsonResponse({ error: "Documento no encontrado" }, 404);
  }

  const { data: submission } = await admin
    .from("document_submissions")
    .select("submitter_name, submitter_email")
    .eq("document_id", doc.id)
    .maybeSingle();

  await admin.from("documents").delete().eq("id", doc.id);

  if (submission?.submitter_email) {
    const name = submission.submitter_name
      ? escapeHtml(submission.submitter_name)
      : "";
    const reasonHtml = reason?.trim()
      ? `<p>Comentario del equipo del COE: ${escapeHtml(reason.trim())}</p>`
      : "";
    await sendEmail(
      submission.submitter_email,
      submission.submitter_name,
      "Tu documento no fue aprobado",
      `<p>Hola${name ? " " + name : ""},</p>
<p>Tu documento <strong>${escapeHtml(doc.filename)}</strong> fue revisado por el equipo del
COE y no fue incluido en la biblioteca del Asistente de Gestión de Emergencias.</p>
${reasonHtml}
<p>Gracias por tu interés en colaborar.</p>`,
    );
  }

  return jsonResponse({ ok: true });
});
