// Edge Function: fetch-external-events
//
// Agrega datos de múltiples fuentes externas de monitoreo de emergencias
// para Centroamérica y República Dominicana:
//   · USGS  — sismos en tiempo real (sin clave)
//   · NHC   — ciclones tropicales activos (sin clave)
//   · EONET — eventos naturales via satélite NASA (sin clave)
//   · GDACS — alertas globales de desastres (sin clave)
//
// Devuelve array de objetos estandarizados. Caché de 5 min por instancia.

// ── CORS para peticiones GET desde el navegador ──────────────
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// ── Bounding box de la región ────────────────────────────────
const R = { minLat: 6.0, maxLat: 22.0, minLon: -93.5, maxLon: -66.0 };

function inRegion(lat: number | null, lon: number | null, expand = 0): boolean {
  if (lat == null || lon == null) return false;
  return (
    lat >= R.minLat - expand && lat <= R.maxLat + expand &&
    lon >= R.minLon - expand && lon <= R.maxLon + expand
  );
}

interface ExternalEvent {
  id:          string;
  source:      string;   // "usgs" | "nhc" | "eonet" | "gdacs"
  type:        string;   // "earthquake" | "cyclone" | "wildfire" | "flood" | "volcano" | ...
  severity:    string;   // "alto" | "medio" | "bajo" | "info"
  title:       string;
  message:     string;
  country:     string | null;
  lat:         number | null;
  lon:         number | null;
  magnitude:   number | null;   // para sismos
  depth_km:    number | null;   // para sismos
  created_at:  string;
  valid_until: string | null;
  link:        string | null;
}

// ── USGS Earthquakes ─────────────────────────────────────────
async function fetchUSGS(): Promise<ExternalEvent[]> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const url =
    "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson" +
    `&minmagnitude=3.5&starttime=${since}` +
    `&minlatitude=${R.minLat}&maxlatitude=${R.maxLat}` +
    `&minlongitude=${R.minLon}&maxlongitude=${R.maxLon}` +
    "&orderby=time&limit=150";

  const res  = await fetch(url, { headers: { "User-Agent": "COE-CEPREDENAC/2.0" } });
  const data = await res.json();

  return (data.features ?? []).map((f: any): ExternalEvent => {
    const p   = f.properties ?? {};
    const mag = Number(p.mag ?? 0);
    const dep = Math.round(Number(f.geometry?.coordinates?.[2] ?? 0));
    const lon = Number(f.geometry?.coordinates?.[0]);
    const lat = Number(f.geometry?.coordinates?.[1]);

    // Generar texto de ubicación más específico
    const place = (p.place ?? "").replace(/^\d+ km [A-Z]+ of /, "");

    return {
      id:          `usgs-${f.id}`,
      source:      "usgs",
      type:        "earthquake",
      severity:    mag >= 6.5 ? "alto" : mag >= 5.0 ? "medio" : mag >= 4.0 ? "bajo" : "info",
      title:       `Sismo M${mag.toFixed(1)} · ${p.place ?? "Centroamérica/RD"}`,
      message:
        `Magnitud ${mag.toFixed(1)} — profundidad ${dep} km.` +
        (place ? ` Localizado en ${place}.` : "") +
        " Fuente: Red Sísmica USGS.",
      country:     null,
      lat,
      lon,
      magnitude:   mag,
      depth_km:    dep,
      created_at:  new Date(Number(p.time)).toISOString(),
      valid_until: null,
      link:        p.url ?? null,
    };
  });
}

// ── NHC — Ciclones tropicales ─────────────────────────────────
async function fetchNHC(): Promise<ExternalEvent[]> {
  try {
    const res  = await fetch("https://www.nhc.noaa.gov/CurrentStormList.json", {
      headers: { "User-Agent": "COE-CEPREDENAC/2.0" },
    });
    if (!res.ok) return [];
    const text = await res.text();
    if (!text.trim().startsWith("[") && !text.trim().startsWith("{")) return [];
    const data = JSON.parse(text);
    const storms: any[] = Array.isArray(data) ? data : Object.values(data).flat() as any[];

    return storms
      .filter(s => {
        const lat = s.lat ? parseFloat(s.lat) : null;
        const lon = s.lon ? parseFloat(s.lon) : null;
        // Incluir sistemas tropicales en el Atlántico/Caribe/Pacífico E que
        // puedan afectar la región (área ampliada)
        return lat != null && lon != null && lat >= 4 && lat <= 35 && lon >= -115 && lon <= -50;
      })
      .map((s): ExternalEvent => {
        const lat = parseFloat(s.lat);
        const lon = parseFloat(s.lon);
        const cls = (s.classification || s.currentClassification || "").toString();
        const mph = parseInt(s.intensity || s.maximumWinds || "0", 10) || 0;
        const sev = cls.toLowerCase().includes("hurricane") ||
                    (cls.toLowerCase().includes("tropical storm") && mph >= 80) ? "alto"
          : cls.toLowerCase().includes("tropical storm") ? "medio" : "bajo";

        return {
          id:          `nhc-${s.id || s.stormNumber || s.name || Math.random()}`,
          source:      "nhc",
          type:        "cyclone",
          severity:    sev,
          title:       (`${cls} ${s.name || ""}`.trim()) || "Sistema tropical",
          message:
            [
              s.headline ? s.headline.trim() : null,
              mph ? `Vientos máx: ${mph} mph (${Math.round(mph * 1.609)} km/h)` : null,
              s.minimumPressure ? `Presión: ${s.minimumPressure} mb` : null,
              "Fuente: Centro Nacional de Huracanes (NHC).",
            ].filter(Boolean).join(" "),
          country:     null,
          lat,
          lon,
          magnitude:   null,
          depth_km:    null,
          created_at:  s.lastUpdate || new Date().toISOString(),
          valid_until: null,
          link:        s.wallet ? `https://www.nhc.noaa.gov/text/${s.wallet}.shtml` : "https://www.nhc.noaa.gov",
        };
      });
  } catch {
    return [];
  }
}

// ── NASA EONET — Eventos naturales ───────────────────────────
async function fetchEONET(): Promise<ExternalEvent[]> {
  const url = "https://eonet.gsfc.nasa.gov/api/v3/events" +
    "?status=open&limit=300&days=14";
  const res  = await fetch(url, { headers: { "User-Agent": "COE-CEPREDENAC/2.0" } });
  const data = await res.json();

  const TYPE_MAP: Record<string, string> = {
    wildfires:    "wildfire",
    severeStorms: "storm",
    volcanoes:    "volcano",
    floods:       "flood",
    earthquakes:  "earthquake",
    landslides:   "landslide",
    drought:      "drought",
  };
  const SEV_MAP: Record<string, string> = {
    wildfires:    "medio",
    severeStorms: "alto",
    volcanoes:    "alto",
    floods:       "medio",
    earthquakes:  "medio",
    landslides:   "bajo",
    drought:      "bajo",
  };

  return (data.events ?? [])
    .filter((ev: any) => {
      const geo = ev.geometry?.[0];
      if (!geo?.coordinates) return false;
      const [lon, lat] = geo.coordinates;
      return inRegion(lat, lon);
    })
    .map((ev: any): ExternalEvent => {
      const geo      = ev.geometry?.[0] ?? {};
      const catId    = ev.categories?.[0]?.id    ?? "other";
      const catTitle = ev.categories?.[0]?.title ?? catId;
      const [lon, lat] = geo.coordinates ?? [null, null];
      const mag = geo.magnitudeValue ? Number(geo.magnitudeValue) : null;

      return {
        id:          `eonet-${ev.id}`,
        source:      "eonet",
        type:        TYPE_MAP[catId] ?? "other",
        severity:    SEV_MAP[catId] ?? "info",
        title:       ev.title,
        message:
          `Detectado vía satélite NASA (${catTitle}).` +
          (mag ? ` Magnitud estimada: ${mag.toFixed(0)} ${geo.magnitudeUnit ?? ""}.` : "") +
          " Fuente: NASA EONET.",
        country:     null,
        lat:         lat  != null ? Number(lat)  : null,
        lon:         lon  != null ? Number(lon)  : null,
        magnitude:   mag,
        depth_km:    null,
        created_at:  geo.date ?? new Date().toISOString(),
        valid_until: null,
        link:        ev.link ?? null,
      };
    });
}

// ── GDACS — Alertas de desastres globales ─────────────────────
async function fetchGDACS(): Promise<ExternalEvent[]> {
  try {
    const url =
      "https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS" +
      "?eventlist=EQ,FL,TC,VO,DR&alertlevel=red;orange;green&lastmonths=1";
    const res  = await fetch(url, {
      headers: {
        "Accept":     "application/json",
        "User-Agent": "COE-CEPREDENAC/2.0",
      },
    });
    const text = await res.text();
    // Si no devuelve JSON GeoJSON válido, salir
    if (!text.includes(`"features"`)) return [];
    const data = JSON.parse(text);

    const TYPE_MAP: Record<string, string> = {
      EQ: "earthquake", TC: "cyclone", FL: "flood", VO: "volcano", DR: "drought",
    };
    const SEV_MAP: Record<string, string> = {
      Red: "alto", Orange: "medio", Green: "bajo",
    };

    return (data.features ?? [])
      .filter((f: any) => {
        const [lon, lat] = f.geometry?.coordinates ?? [];
        return inRegion(lat, lon);
      })
      .map((f: any): ExternalEvent => {
        const p   = f.properties ?? {};
        const msg = (p.description ?? p.htmldescription ?? "")
          .replace(/<[^>]*>/g, "")
          .trim()
          .slice(0, 300);
        return {
          id:          `gdacs-${p.eventid ?? f.id}`,
          source:      "gdacs",
          type:        TYPE_MAP[p.eventtype] ?? "disaster",
          severity:    SEV_MAP[p.alertlevel] ?? "info",
          title:       p.name ?? `${p.eventtype ?? "Evento"} · GDACS`,
          message:     (msg || "Ver enlace para más detalles.") + " Fuente: GDACS.",
          country:     p.country ?? null,
          lat:         Number(f.geometry?.coordinates?.[1]) || null,
          lon:         Number(f.geometry?.coordinates?.[0]) || null,
          magnitude:   null,
          depth_km:    null,
          created_at:  p.toDate ?? p.fromDate ?? new Date().toISOString(),
          valid_until: null,
          link:        p.url?.report ?? "https://www.gdacs.org",
        };
      });
  } catch {
    return [];
  }
}

// ── Caché ────────────────────────────────────────────────────
let cacheData: ExternalEvent[] = [];
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

// ── Handler ──────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  // Devolver caché si sigue fresca
  if (Date.now() - cacheTime < CACHE_TTL) {
    return new Response(JSON.stringify(cacheData), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // Forzar refresco con ?refresh=1
  const forceRefresh = new URL(req.url).searchParams.has("refresh");
  if (!forceRefresh && cacheData.length > 0) {
    return new Response(JSON.stringify(cacheData), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const results = await Promise.allSettled([
    fetchUSGS(),
    fetchNHC(),
    fetchEONET(),
    fetchGDACS(),
  ]);

  const all: ExternalEvent[] = results.flatMap(r =>
    r.status === "fulfilled" ? r.value : [],
  );

  // Deduplicar por id
  const seen    = new Set<string>();
  cacheData     = all.filter(e => seen.has(e.id) ? false : (seen.add(e.id), true));
  cacheTime     = Date.now();

  // Estadísticas en el log (visible en Supabase Dashboard)
  const bySource = Object.fromEntries(
    ["usgs", "nhc", "eonet", "gdacs"].map(s => [s, cacheData.filter(e => e.source === s).length]),
  );
  console.log("[fetch-external-events]", bySource, `total=${cacheData.length}`);

  return new Response(JSON.stringify(cacheData), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
