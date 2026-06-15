// ============================================================
// Página pública "Enviar un documento"
// ============================================================
// Cualquier persona puede proponer un documento (PDF/Word/Excel)
// para la biblioteca del asistente. El texto se extrae en el
// navegador y se envía a la Edge Function pública "submit-document",
// que lo guarda como pendiente de revisión.
// ============================================================

import { extractText } from "../shared/extract.js";
import { fillCountrySelect } from "../shared/countries.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../shared/config.js";

const form = document.getElementById("submit-form");
const fileInput = document.getElementById("f-file");
const countryOriginSelect = document.getElementById("f-country-origin");
const countryApplicableSelect = document.getElementById("f-country-applicable");
const descriptionInput = document.getElementById("f-description");
const nameInput = document.getElementById("f-name");
const emailInput = document.getElementById("f-email");
const submitBtn = document.getElementById("submit-btn");
const statusEl = document.getElementById("submit-status");

fillCountrySelect(countryOriginSelect, { placeholder: "Selecciona un país" });
fillCountrySelect(countryApplicableSelect, {
  placeholder: "Selecciona una opción",
  includeGeneral: true,
  generalLabel: "General / aplica a varios países",
});

function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = type ? type : "";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const file = fileInput.files[0];
  if (!file) return;

  submitBtn.disabled = true;
  setStatus("Procesando archivo en tu navegador...", "hint");

  try {
    const text = await extractText(file);
    if (!text || !text.trim()) {
      throw new Error("No se pudo extraer texto del archivo.");
    }

    setStatus("Enviando documento...", "hint");

    const res = await fetch(`${SUPABASE_URL}/functions/v1/submit-document`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        filename: file.name,
        mime_type: file.type,
        text,
        country_origin: countryOriginSelect.value,
        country_applicable: countryApplicableSelect.value || undefined,
        description: descriptionInput.value.trim() || undefined,
        submitter_name: nameInput.value.trim() || undefined,
        submitter_email: emailInput.value.trim() || undefined,
      }),
    });

    const result = await res.json();
    if (!res.ok || result.error) {
      throw new Error(result.error || "Ocurrió un error al enviar el documento.");
    }

    setStatus(
      "¡Gracias! Tu documento fue recibido y será revisado por el equipo del COE. " +
        (emailInput.value.trim()
          ? "Te avisaremos por correo cuando sea revisado."
          : ""),
      "success",
    );
    form.reset();
    fillCountrySelect(countryOriginSelect, { placeholder: "Selecciona un país" });
    fillCountrySelect(countryApplicableSelect, {
      placeholder: "Selecciona una opción",
      includeGeneral: true,
      generalLabel: "General / aplica a varios países",
    });
  } catch (err) {
    setStatus("Error: " + err.message, "error");
  } finally {
    submitBtn.disabled = false;
  }
});
