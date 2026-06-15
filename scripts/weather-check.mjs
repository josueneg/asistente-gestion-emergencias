#!/usr/bin/env node
// ============================================================
// Monitoreo continuo del clima para el COE
// ============================================================
// Ejecutado cada 15 minutos por .github/workflows/weather-check.yml
//
// 1. Lee las ubicaciones a monitorear desde Supabase (tabla weather_config).
// 2. Consulta Open-Meteo pidiendo VARIOS MODELOS METEOROLÓGICOS a la vez
//    (esto es la "visión de múltiples puntos de vista").
// 3. Si algún modelo supera los umbrales configurados, llama a la Edge
//    Function "weather-alert" para que la IA evalúe el consenso entre
//    modelos y, si corresponde, redacte una alerta en español.
//
// Requiere Node 18+ (usa fetch global). No necesita "npm install".
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const WEATHER_CRON_SECRET = process.env.WEATHER_CRON_SECRET;

// Modelos meteorológicos consultados en cada chequeo (todos gratis vía Open-Meteo)
const WEATHER_MODELS = [
  "ecmwf_ifs025",
  "gfs_seamless",
  "icon_seamless",
  "gem_seamless",
];

const FORECAST_HOURS = 6;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !WEATHER_CRON_SECRET) {
  console.error(
    "Faltan variables de entorno: SUPABASE_URL, SUPABASE_ANON_KEY, WEATHER_CRON_SECRET",
  );
  process.exit(1);
}

async function getLocations() {
  const url = `${SUPABASE_URL}/rest/v1/weather_config?enabled=eq.true&select=*`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });
  if (!res.ok) {
    throw new Error(
      `Error leyendo weather_config: ${res.status} ${await res.text()}`,
    );
  }
  return res.json();
}

async function getForecast(lat, lon) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: "precipitation,wind_speed_10m,wind_gusts_10m",
    models: WEATHER_MODELS.join(","),
    forecast_hours: String(FORECAST_HOURS),
    wind_speed_unit: "kmh",
    timezone: "America/Panama",
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Error de Open-Meteo: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

function maxValue(arr) {
  const nums = (arr ?? []).filter((v) => typeof v === "number");
  return nums.length ? Math.max(...nums) : undefined;
}

// Convierte la respuesta de Open-Meteo (con columnas por modelo) en un
// resumen { modelo: { max_precip_mm_h, max_wind_kmh, max_gust_kmh } }
function summarizeByModel(hourly) {
  const summary = {};
  for (const model of WEATHER_MODELS) {
    const precip = hourly[`precipitation_${model}`];
    const wind = hourly[`wind_speed_10m_${model}`];
    const gusts = hourly[`wind_gusts_10m_${model}`];
    if (!precip && !wind && !gusts) continue; // modelo sin datos para esta ubicación

    summary[model] = {
      max_precip_mm_h: maxValue(precip),
      max_wind_kmh: maxValue(wind),
      max_gust_kmh: maxValue(gusts),
    };
  }
  return summary;
}

function exceedsThreshold(summary, location) {
  return Object.values(summary).some((m) =>
    (m.max_precip_mm_h ?? 0) >= location.rain_threshold_mm_h ||
    (m.max_wind_kmh ?? 0) >= location.wind_threshold_kmh ||
    (m.max_gust_kmh ?? 0) >= location.wind_threshold_kmh
  );
}

async function sendAlertCheck(location, summary) {
  const url = `${SUPABASE_URL}/functions/v1/weather-alert`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Las Edge Functions de Supabase exigen un Authorization válido;
      // la anon key cumple ese requisito. La autorización real la hace
      // la cabecera x-cron-secret.
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "x-cron-secret": WEATHER_CRON_SECRET,
    },
    body: JSON.stringify({
      location_name: location.location_name,
      lat: location.lat,
      lon: location.lon,
      thresholds: {
        rain_threshold_mm_h: location.rain_threshold_mm_h,
        wind_threshold_kmh: location.wind_threshold_kmh,
      },
      models: summary,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`weather-alert respondió ${res.status}:`, data);
    return;
  }
  if (data.alert_created) {
    console.log(
      `Alerta creada para ${location.location_name}: ${data.alert_id}`,
    );
  } else {
    console.log(
      `Sin alerta para ${location.location_name} (la IA no encontró consenso de riesgo).`,
    );
  }
}

async function main() {
  const locations = await getLocations();
  console.log(`Revisando ${locations.length} ubicación(es)...`);

  for (const location of locations) {
    try {
      const forecast = await getForecast(location.lat, location.lon);
      const summary = summarizeByModel(forecast.hourly ?? {});
      console.log(`${location.location_name}:`, JSON.stringify(summary));

      if (Object.keys(summary).length === 0) {
        console.warn(`Sin datos de modelos para ${location.location_name}`);
        continue;
      }

      if (exceedsThreshold(summary, location)) {
        console.log(
          `Umbral superado en ${location.location_name}, consultando IA para confirmar...`,
        );
        await sendAlertCheck(location, summary);
      } else {
        console.log(`${location.location_name}: dentro de los umbrales normales.`);
      }
    } catch (err) {
      console.error(`Error procesando ${location.location_name}:`, err);
    }
  }
}

main().catch((err) => {
  console.error("Error fatal:", err);
  process.exit(1);
});
