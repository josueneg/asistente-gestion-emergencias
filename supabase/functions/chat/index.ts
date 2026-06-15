// Edge Function: chat
//
// Endpoint público (validado por site_key) que usa el widget embebido.
// Implementa RAG: busca los fragmentos de documentos del COE más
// relevantes para la pregunta y le pide a Groq que responda/recomiende
// con base en ellos.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { embedText } from "../_shared/gemini.ts";
import { groqChat } from "../_shared/groq.ts";

const RATE_LIMIT_PER_HOUR = 60;
const MATCH_COUNT = 5;

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Método no permitido" }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let payload: { site_key?: string; question?: string; session_id?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "JSON inválido" }, 400);
  }

  const { site_key, question, session_id } = payload;
  if (!site_key || !question || question.trim().length === 0) {
    return jsonResponse({ error: "Faltan 'site_key' o 'question'" }, 400);
  }

  // 1. Validar site_key (emitida desde el panel admin)
  const { data: site, error: siteError } = await admin
    .from("sites")
    .select("id, allowed_origin")
    .eq("site_key", site_key)
    .maybeSingle();

  if (siteError || !site) {
    return jsonResponse({ error: "site_key inválida" }, 403);
  }

  // 2. Límite simple de solicitudes por hora, por sitio
  //    (protege la cuota gratuita de Groq/Gemini ante abuso)
  const windowStart = new Date();
  windowStart.setMinutes(0, 0, 0);

  const { data: counter } = await admin
    .from("rate_limit_counters")
    .select("request_count")
    .eq("site_id", site.id)
    .eq("window_start", windowStart.toISOString())
    .maybeSingle();

  if (counter && counter.request_count >= RATE_LIMIT_PER_HOUR) {
    return jsonResponse(
      { error: "Límite de solicitudes alcanzado, intenta más tarde" },
      429,
    );
  }

  await admin.from("rate_limit_counters").upsert(
    {
      site_id: site.id,
      window_start: windowStart.toISOString(),
      request_count: (counter?.request_count ?? 0) + 1,
    },
    { onConflict: "site_id,window_start" },
  );

  // 3. Buscar fragmentos relevantes de los documentos del COE (RAG)
  let contextText = "";
  let sources: string[] = [];
  try {
    const queryEmbedding = await embedText(question, "RETRIEVAL_QUERY");
    const { data: matches } = await admin.rpc("match_doc_chunks", {
      query_embedding: queryEmbedding,
      match_count: MATCH_COUNT,
    });

    if (matches && matches.length > 0) {
      const docIds = [...new Set(matches.map((m: any) => m.document_id))];
      const { data: docs } = await admin
        .from("documents")
        .select("id, filename")
        .in("id", docIds);

      const filenameById = new Map(
        (docs ?? []).map((d: any) => [d.id, d.filename]),
      );

      contextText = matches
        .map((m: any, i: number) =>
          `[Fragmento ${i + 1} - ${filenameById.get(m.document_id) ?? "documento"}]\n${m.content}`
        )
        .join("\n\n");

      sources = [
        ...new Set(
          matches.map((m: any) => filenameById.get(m.document_id) ?? "documento"),
        ),
      ] as string[];
    }
  } catch (err) {
    console.error("Error en búsqueda RAG:", err);
  }

  // 4. Generar respuesta con Groq
  const systemPrompt =
    `Eres el asistente virtual del Centro de Operaciones de Emergencia (COE) de Panamá.
Responde siempre en español, de forma clara y operativa.
Si hay fragmentos de manuales o planes de emergencia más abajo, básate en ellos para responder y,
cuando aplique, da una RECOMENDACIÓN concreta siguiendo el procedimiento descrito (qué hacer, en qué
orden y quién debería actuar).
Si la pregunta no está relacionada con los documentos, respóndela de todas formas de forma breve y útil.
Si no encuentras información suficiente en los documentos para una pregunta operativa, dilo explícitamente
y ofrece una recomendación general basada en buenas prácticas de gestión de emergencias.

${
      contextText
        ? `DOCUMENTOS DEL COE RELEVANTES:\n${contextText}`
        : "No se encontraron fragmentos relevantes en los documentos del COE para esta pregunta."
    }`;

  let answer: string;
  try {
    answer = await groqChat([
      { role: "system", content: systemPrompt },
      { role: "user", content: question },
    ]);
  } catch (err) {
    return jsonResponse({ error: `Error generando respuesta: ${err}` }, 500);
  }

  // 5. Guardar en el historial (auditoría)
  await admin.from("chat_logs").insert({
    site_id: site.id,
    session_id: session_id ?? null,
    question,
    answer,
  });

  return jsonResponse({ answer, sources });
});
