// Cliente mínimo para generar embeddings con Google Gemini (AI Studio).
// Se usa con cuota gratuita: solo se llama al subir documentos y al
// procesar cada pregunta del chat (volumen bajo para un COE pequeño).

const EMBEDDING_MODEL = "gemini-embedding-001";

// 768 dimensiones: suficiente calidad para RAG y reduce el espacio
// usado en la base de datos gratuita de Supabase (límite 500MB).
export const EMBEDDING_DIM = 768;

export type EmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Reintentos con espera creciente para 429 (cuota excedida) y 503
// (modelo sobrecargado), que son errores temporales típicos de la
// cuota gratuita de Gemini.
const RETRY_DELAYS_MS = [2000, 5000, 10000, 20000];

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
  const body = JSON.stringify({
    model: `models/${EMBEDDING_MODEL}`,
    content: { parts: [{ text }] },
    taskType,
    outputDimensionality: EMBEDDING_DIM,
  });

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (res.ok) {
      const data = await res.json();
      const values = data?.embedding?.values;
      if (!Array.isArray(values)) {
        throw new Error("Respuesta de Gemini embeddings sin 'embedding.values'");
      }
      return values as number[];
    }

    const errText = await res.text();
    const canRetry = (res.status === 429 || res.status === 503) &&
      attempt < RETRY_DELAYS_MS.length;
    if (!canRetry) {
      throw new Error(`Error de Gemini embeddings (${res.status}): ${errText}`);
    }
    await sleep(RETRY_DELAYS_MS[attempt]);
  }

  throw new Error("Error de Gemini embeddings: reintentos agotados");
}
