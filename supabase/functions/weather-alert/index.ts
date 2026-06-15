// Edge Function: weather-alert
//
// Llamada por el cron de GitHub Actions (scripts/weather-check.mjs)
// cuando algún modelo meteorológico supera los umbrales configurados.
// Le pide a Groq que evalúe el CONSENSO entre modelos y redacte una
// alerta en español. Si la IA considera que no hay riesgo real,
// no se crea ninguna alerta.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { groqChat } from "../_shared/groq.ts";

interface ModelForecast {
  max_precip_mm_h?: number;
  max_wind_kmh?: number;
  max_gust_kmh?: number;
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Método no permitido" }, 405);
  }

  // Verifica el secreto compartido con el workflow de GitHub Actions.
  // Evita que cualquiera con la anon key dispare alertas falsas.
  const cronSecret = Deno.env.get("WEATHER_CRON_SECRET");
  const providedSecret = req.headers.get("x-cron-secret");
  if (!cronSecret || providedSecret !== cronSecret) {
    return jsonResponse({ error: "No autorizado" }, 401);
  }

  let payload: {
    location_name?: string;
    lat?: number;
    lon?: number;
    thresholds?: { rain_threshold_mm_h?: number; wind_threshold_kmh?: number };
    models?: Record<string, ModelForecast>;
  };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "JSON inválido" }, 400);
  }

  const { location_name, lat, lon, thresholds, models } = payload;
  if (!location_name || !models) {
    return jsonResponse({ error: "Faltan datos del pronóstico" }, 400);
  }

  const prompt =
    `Eres un meteorólogo del Centro de Operaciones de Emergencia (COE) de Panamá.
Analiza estos pronósticos de DIFERENTES MODELOS METEOROLÓGICOS para la ubicación "${location_name}"
(lat ${lat}, lon ${lon}) para las próximas horas.

Umbrales de alerta configurados:
- Lluvia: ${thresholds?.rain_threshold_mm_h ?? "?"} mm/h
- Viento: ${thresholds?.wind_threshold_kmh ?? "?"} km/h

Datos por modelo (lluvia máxima en mm/h, viento máximo y rachas máximas en km/h, para las próximas horas):
${JSON.stringify(models, null, 2)}

Evalúa el CONSENSO entre modelos, no un valor aislado. Responde ÚNICAMENTE con un objeto JSON con esta forma exacta:
{
  "alerta": true o false,
  "severidad": "bajo" | "medio" | "alto",
  "titulo": "string corto",
  "mensaje": "string en español, breve, indicando el fenómeno esperado y una recomendación operativa para el COE"
}

Si el consenso entre modelos NO indica un riesgo real (por ejemplo, solo un modelo aislado supera el umbral
mientras el resto no, o los valores son marginales), responde con "alerta": false.`;

  let result: {
    alerta: boolean;
    severidad?: string;
    titulo?: string;
    mensaje?: string;
  };

  try {
    const raw = await groqChat(
      [
        {
          role: "system",
          content: "Respondes únicamente con JSON válido, sin texto adicional.",
        },
        { role: "user", content: prompt },
      ],
      { temperature: 0.2, jsonMode: true },
    );
    result = JSON.parse(raw);
  } catch (err) {
    return jsonResponse({ error: `Error generando alerta: ${err}` }, 500);
  }

  if (!result.alerta) {
    return jsonResponse({ alert_created: false });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: alert, error } = await admin
    .from("alerts")
    .insert({
      type: "weather",
      severity: result.severidad ?? "medio",
      title: result.titulo ?? `Alerta de clima - ${location_name}`,
      message: result.mensaje ?? "",
      raw_data: { location_name, lat, lon, thresholds, models },
    })
    .select()
    .single();

  if (error) {
    return jsonResponse(
      { error: `No se pudo guardar la alerta: ${error.message}` },
      500,
    );
  }

  return jsonResponse({ alert_created: true, alert_id: alert.id });
});
