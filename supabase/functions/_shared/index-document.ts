// Divide un documento en fragmentos, genera sus embeddings con Gemini
// y los guarda en doc_chunks. Usado por "ingest-document" (subidas del
// admin) y "approve-document" (documentos enviados por el público y
// aprobados).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { embedText } from "./gemini.ts";
import { chunkText } from "./chunk.ts";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function indexDocumentChunks(
  admin: SupabaseClient,
  documentId: string,
  text: string,
): Promise<number> {
  const chunks = chunkText(text);

  // Si un intento anterior falló a mitad de camino, borrar los fragmentos
  // que ya se habían guardado para no duplicarlos al reintentar.
  await admin.from("doc_chunks").delete().eq("document_id", documentId);

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await embedText(chunks[i], "RETRIEVAL_DOCUMENT");
    const { error } = await admin.from("doc_chunks").insert({
      document_id: documentId,
      chunk_index: i,
      content: chunks[i],
      embedding,
    });
    if (error) throw new Error(error.message);

    // Pequeña pausa entre fragmentos para no exceder el límite de
    // solicitudes por minuto de la cuota gratuita de Gemini.
    if (i < chunks.length - 1) await sleep(250);
  }

  return chunks.length;
}
