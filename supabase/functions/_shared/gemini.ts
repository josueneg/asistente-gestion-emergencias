// Cliente mínimo para generar embeddings con Google Gemini (AI Studio).
// Se usa con cuota gratuita: solo se llama al subir documentos y al
// procesar cada pregunta del chat (volumen bajo para un COE pequeño).

const EMBEDDING_MODEL = "gemini-embedding-001";

// 768 dimensiones: suficiente calidad para RAG y reduce el espacio
// usado en la base de datos gratuita de Supabase (límite 500MB).
export const EMBEDDING_DIM = 768;

export type EmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export async function embedText(
  text: string,
  taskType: EmbeddingTaskType,
): Promise<number[]> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    throw new Error("Falta la variable de entorno GEMINI_API_KEY");
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text }] },
      taskType,
      outputDimensionality: EMBEDDING_DIM,
    }),
  });

  if (!res.ok) {
    throw new Error(`Error de Gemini embeddings (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  const values = data?.embedding?.values;
  if (!Array.isArray(values)) {
    throw new Error("Respuesta de Gemini embeddings sin 'embedding.values'");
  }
  return values as number[];
}
