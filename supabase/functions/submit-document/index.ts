// Edge Function: submit-document
//
// Endpoint público (sin autenticación) usado por la página "enviar/"
// para que cualquier persona proponga un documento para la biblioteca.
// El texto ya viene extraído (se parsea en el navegador, igual que en
// el panel admin). El documento queda con approval_status='pending'
// hasta que el admin lo revise desde el panel ("Bandeja de entrada").

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { isValidCountry } from "../_shared/countries.ts";

const RATE_LIMIT_PER_HOUR = 5;
const MIN_TEXT_LENGTH = 50;
const MAX_TEXT_LENGTH = 400000;

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
    submitter_name?: string;
    submitter_email?: string;
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
  } = payload;

  if (!filename || !text || !country_origin) {
    return jsonResponse(
      { error: "Faltan 'filename', 'text' o 'country_origin'" },
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
    })
    .select("id")
    .single();

  if (insertError || !doc) {
    return jsonResponse(
      { error: `No se pudo guardar el documento: ${insertError?.message}` },
      500,
    );
  }

  // 3. Guardar datos de contacto (si se dieron) para poder notificar
  if (submitter_name?.trim() || submitter_email?.trim()) {
    await admin.from("document_submissions").insert({
      document_id: doc.id,
      submitter_name: submitter_name?.trim() || null,
      submitter_email: submitter_email?.trim() || null,
    });
  }

  return jsonResponse({
    document_id: doc.id,
    message: "Documento recibido. Será revisado por el equipo del COE.",
  });
});
