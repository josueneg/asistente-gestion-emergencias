// ============================================================
// Fuentes de datos externas — COE Centroamérica
// Llama a la Edge Function fetch-external-events que agrega
// USGS (sismos), NHC (ciclones), EONET (NASA) y GDACS.
// ============================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../shared/config.js";

export async function fetchExternalEvents() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/functions/v1/fetch-external-events`,
      {
        headers: {
          "apikey":        SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        },
      },
    );
    if (!res.ok) {
      console.warn("[sources] fetch-external-events HTTP", res.status);
      return [];
    }
    return res.json();
  } catch (e) {
    console.warn("[sources] fetch-external-events error:", e);
    return [];
  }
}
