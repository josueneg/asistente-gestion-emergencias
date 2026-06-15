// Cliente mínimo para Groq (LLM gratuito, API compatible con OpenAI).
// Se usa tanto para responder el chat (RAG) como para redactar las
// alertas de clima.

const GROQ_MODEL = "llama-3.3-70b-versatile";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function groqChat(
  messages: ChatMessage[],
  opts: { temperature?: number; jsonMode?: boolean } = {},
): Promise<string> {
  const apiKey = Deno.env.get("GROQ_API_KEY");
  if (!apiKey) {
    throw new Error("Falta la variable de entorno GROQ_API_KEY");
  }

  const body: Record<string, unknown> = {
    model: GROQ_MODEL,
    messages,
    temperature: opts.temperature ?? 0.3,
  };

  if (opts.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Error de Groq (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Respuesta de Groq sin contenido");
  }
  return content;
}
