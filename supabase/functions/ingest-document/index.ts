// Edge Function: ingest-document
//
// Recibe el texto YA EXTRAÍDO de un documento (PDF/Word/Excel se
// parsean en el navegador, ver admin/admin.js), lo divide en
// fragmentos, genera sus embeddings con Gemini y los guarda en
// la base vectorial para que "chat" pueda usarlos (RAG).
//
// Requiere que quien llama esté autenticado (personal del COE).

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { embedText } from "../_shared/gemini.ts";
import { chunkText } from "../_shared/chunk.ts";

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
  let payload: { filename?: string; mime_type?: string; text?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "JSON inválido" }, 400);
  }

  const { filename, mime_type, text } = payload;
  if (!filename || !text || text.trim().length === 0) {
    return jsonResponse({ error: "Faltan 'filename' o 'text'" }, 400);
  }

  // 3. Cliente con privilegios para escribir en la base de datos
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: doc, error: insertError } = await admin
    .from("documents")
    .insert({
      filename,
      mime_type: mime_type ?? null,
      status: "pending",
      char_count: text.length,
      uploaded_by: userData.user.id,
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
  const chunks = chunkText(text);

  try {
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await embedText(chunks[i], "RETRIEVAL_DOCUMENT");
      const { error: chunkError } = await admin.from("doc_chunks").insert({
        document_id: doc.id,
        chunk_index: i,
        content: chunks[i],
        embedding,
      });
      if (chunkError) throw new Error(chunkError.message);
    }

    await admin.from("documents").update({ status: "indexed" }).eq(
      "id",
      doc.id,
    );

    return jsonResponse({ document_id: doc.id, chunks: chunks.length });
  } catch (err) {
    await admin
      .from("documents")
      .update({ status: "error", error_message: String(err) })
      .eq("id", doc.id);
    return jsonResponse({ error: `Fallo al indexar: ${err}` }, 500);
  }
});
