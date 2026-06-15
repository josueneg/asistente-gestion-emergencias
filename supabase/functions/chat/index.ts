// Edge Function: chat
//
// Endpoint público (validado por site_key) que usa el widget embebido.
// Implementa RAG: busca los fragmentos de documentos aprobados más
// relevantes (opcionalmente filtrados por país) y le pide a Groq que
// responda/recomiende con base en ellos.
//
// mode="recommendations": en vez de responder una pregunta, analiza
// los documentos aprobados (de un país, si se indica) y propone
// mejoras concretas.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { embedText } from "../_shared/gemini.ts";
import { groqChat } from "../_shared/groq.ts";

const RATE_LIMIT_PER_HOUR = 60;
const MATCH_COUNT = 5;
const RECOMMENDATION_MATCH_COUNT = 12;
const RECOMMENDATION_QUERY =
  "Riesgos, vacíos, debilidades y oportunidades de mejora en los planes, procedimientos y " +
  "capacidades de gestión de emergencias.";

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
    site_key?: string;
    question?: string;
    session_id?: string;
    country?: string;
    mode?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "JSON inválido" }, 400);
  }

  const { site_key, question, session_id, mode } = payload;
  const isRecommendations = mode === "recommendations";
  const countryFilter = payload.country?.trim() || null;

  if (!site_key) {
    return jsonResponse({ error: "Falta 'site_key'" }, 400);
  }
  if (!isRecommendations && (!question || question.trim().length === 0)) {
    return jsonResponse({ error: "Falta 'question'" }, 400);
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

  // 3. Buscar fragmentos relevantes de los documentos aprobados (RAG)
  //    - chat normal: busca por similitud con la pregunta
  //    - recomendaciones: busca por similitud con una consulta de
  //      análisis (o el tema indicado), trayendo más fragmentos
  const searchText = isRecommendations
    ? question?.trim() || RECOMMENDATION_QUERY
    : question!;
  const matchCount = isRecommendations ? RECOMMENDATION_MATCH_COUNT : MATCH_COUNT;

  let contextText = "";
  let sources: string[] = [];
  try {
    const queryEmbedding = await embedText(searchText, "RETRIEVAL_QUERY");
    const { data: matches } = await admin.rpc("match_doc_chunks", {
      query_embedding: queryEmbedding,
      match_count: matchCount,
      country_filter: countryFilter,
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
  const countrySuffix = countryFilter ? ` de ${countryFilter}` : "";
  let systemPrompt: string;
  let userMessage: string;

  if (isRecommendations) {
    systemPrompt =
      `Eres un analista experto en gestión de riesgos y emergencias${countrySuffix}.
A partir EXCLUSIVAMENTE de los fragmentos de documentos aprobados que se listan abajo,
identifica entre 3 y 6 mejoras concretas y priorizadas para fortalecer la gestión de
emergencias${countrySuffix}. Para cada mejora indica: (1) qué mejorar, (2) en qué documento
se basa, (3) una acción concreta sugerida.
Si los fragmentos no cubren algún tema importante, señálalo explícitamente como un vacío de
información y sugiere qué tipo de documento haría falta.
Responde en español, en una lista numerada, de forma clara, directa y muy analítica.

${
        contextText
          ? `FRAGMENTOS DISPONIBLES:\n${contextText}`
          : `No hay documentos aprobados disponibles${countrySuffix} todavía. Indícalo ` +
            `explícitamente y sugiere qué tipo de documentos sería útil incorporar a la ` +
            `biblioteca para poder generar recomendaciones.`
      }`;
    userMessage = question?.trim()
      ? `Genera recomendaciones de mejora enfocadas en: ${question.trim()}`
      : "Genera recomendaciones de mejora para la gestión de emergencias.";
  } else {
    systemPrompt =
      `Eres el asistente virtual del Centro de Operaciones de Emergencia (COE)${countrySuffix}.
Responde siempre en español, de forma clara, directa y MUY analítica: razona a partir de los
documentos antes de concluir y no inventes información que no esté en ellos.
Si hay fragmentos de manuales o planes de emergencia más abajo, básate en ellos para responder y,
cuando aplique, da una RECOMENDACIÓN concreta siguiendo el procedimiento descrito (qué hacer, en qué
orden y quién debería actuar).
Si la pregunta no está relacionada con los documentos, respóndela de todas formas de forma breve y útil.
Si no encuentras información suficiente en los documentos para una pregunta operativa, dilo explícitamente
y ofrece una recomendación general basada en buenas prácticas de gestión de emergencias.

${
        contextText
          ? `DOCUMENTOS RELEVANTES:\n${contextText}`
          : "No se encontraron fragmentos relevantes en los documentos aprobados para esta pregunta."
      }`;
    userMessage = question!;
  }

  let answer: string;
  try {
    answer = await groqChat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ]);
  } catch (err) {
    return jsonResponse({ error: `Error generando respuesta: ${err}` }, 500);
  }

  // 5. Guardar en el historial (auditoría)
  await admin.from("chat_logs").insert({
    site_id: site.id,
    session_id: session_id ?? null,
    question: isRecommendations ? `[Recomendaciones] ${userMessage}` : question,
    answer,
  });

  return jsonResponse({ answer, sources });
});
