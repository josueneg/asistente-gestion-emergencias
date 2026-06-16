// Edge Function: submit-document
//
// Endpoint público (sin autenticación) usado por la página "enviar/"
// para que cualquier persona proponga un documento para la biblioteca.
// El texto ya viene extraído (se parsea en el navegador). El documento
// queda con approval_status='pending' hasta que el admin lo revise.
//
// Campos del remitente (nombre, correo, institución) son OBLIGATORIOS
// desde Fase 2.
//
// Retorna también un 'upload_url' (signed URL de Supabase Storage) para
// que el cliente suba el archivo original directamente vía PUT — esto
// permite descargar el documento desde la biblioteca una vez aprobado.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { isValidCountry } from "../_shared/countries.ts";
import { isValidPhase } from "../_shared/phases.ts";
import {
  createSignedUploadUrl,
  documentStoragePath,
} from "../_shared/storage.ts";

const RATE_LIMIT_PER_HOUR = 5;
const MIN_TEXT_LENGTH = 50;
const MAX_TEXT_LENGTH = 400000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Método no permitido" }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let payload: {
    filename?: string;
    mime_type?: string;
    text?: string;
    country_origin?: string;
    country_applicable?: string;
    description?: string;
    phases?: string[];
    phase_other?: string;
    submitter_name?: string;
    submitter_email?: string;
    submitter_institution?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "JSON inválido" }, 400);
  }

  const {
    filename,
    mime_type,
    text,
    country_origin,
    description,
    submitter_name,
    submitter_email,
    submitter_institution,
  } = payload;

  // Campos requeridos del documento
  if (!filename || !text || !country_origin) {
    return jsonResponse(
      { error: "Faltan 'filename', 'text' o 'country_origin'" },
      400,
    );
  }

  // Campos requeridos del remitente (obligatorios desde Fase 2)
  if (!submitter_name?.trim()) {
    return jsonResponse({ error: "Tu nombre es obligatorio" }, 400);
  }
  if (!submitter_email?.trim() || !EMAIL_RE.test(submitter_email.trim())) {
    return jsonResponse(
      { error: "Correo electrónico inválido o no proporcionado" },
      400,
    );
  }
  if (!submitter_institution?.trim()) {
    return jsonResponse(
      { error: "La institución a la que perteneces es obligatoria" },
      400,
    );
  }

  const trimmed = text.trim();
  if (trimmed.length < MIN_TEXT_LENGTH) {
    return jsonResponse(
      { error: "El documento tiene muy poco texto para ser útil" },
      400,
    );
  }
  if (trimmed.length > MAX_TEXT_LENGTH) {
    return jsonResponse({ error: "El documento es demasiado grande" }, 400);
  }

  if (!isValidCountry(country_origin)) {
    return jsonResponse({ error: "País de procedencia inválido" }, 400);
  }

  const countryApplicable = payload.country_applicable?.trim() || null;
  if (countryApplicable && !isValidCountry(countryApplicable)) {
    return jsonResponse({ error: "País al que aplica inválido" }, 400);
  }

  const phases = Array.isArray(payload.phases)
    ? payload.phases.filter((p) => isValidPhase(p))
    : null;

  // 1. Límite simple por IP (anti-abuso del buzón público)
  const ip =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const ipHash = await hashIp(ip);

  const windowStart = new Date();
  windowStart.setMinutes(0, 0, 0);

  const { data: counter } = await admin
    .from("submission_rate_limits")
    .select("request_count")
    .eq("ip_hash", ipHash)
    .eq("window_start", windowStart.toISOString())
    .maybeSingle();

  if (counter && counter.request_count >= RATE_LIMIT_PER_HOUR) {
    return jsonResponse(
      { error: "Has enviado demasiados documentos, intenta más tarde" },
      429,
    );
  }

  await admin.from("submission_rate_limits").upsert(
    {
      ip_hash: ipHash,
      window_start: windowStart.toISOString(),
      request_count: (counter?.request_count ?? 0) + 1,
    },
    { onConflict: "ip_hash,window_start" },
  );

  // 2. Crear el documento en estado "pendiente de revisión"
  const storagePath = documentStoragePath(
    "pending_placeholder",
    filename,
  );
  const { data: doc, error: insertError } = await admin
    .from("documents")
    .insert({
      filename,
      mime_type: mime_type ?? null,
      status: "pending",
      approval_status: "pending",
      char_count: trimmed.length,
      country_origin,
      country_applicable: countryApplicable,
      description: description?.trim() || null,
      raw_text: trimmed,
      phases: phases && phases.length > 0 ? phases : null,
      phase_other: payload.phase_other?.trim() || null,
    })
    .select("id")
    .single();

  if (insertError || !doc) {
    return jsonResponse(
      { error: `No se pudo guardar el documento: ${insertError?.message}` },
      500,
    );
  }

  // 3. Preparar la ruta de almacenamiento con el ID real y generar la URL firmada
  const realStoragePath = documentStoragePath(doc.id, filename);
  await admin
    .from("documents")
    .update({ storage_path: realStoragePath })
    .eq("id", doc.id);

  const uploadUrl = await createSignedUploadUrl(admin, doc.id, filename);

  // 4. Guardar datos del remitente (ahora siempre obligatorios)
  await admin.from("document_submissions").insert({
    document_id: doc.id,
    submitter_name: submitter_name.trim(),
    submitter_email: submitter_email.trim(),
    submitter_institution: submitter_institution.trim(),
  });

  return jsonResponse({
    document_id: doc.id,
    upload_url: uploadUrl,
    message: "Documento recibido. Será revisado por el equipo del COE.",
  });
});
