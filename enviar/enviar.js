// ============================================================
// Página pública "Enviar un documento"
// ============================================================
// Cualquier persona puede proponer un documento (PDF/Word/Excel)
// para la biblioteca del asistente. El texto se extrae en el
// navegador y se envía a submit-document junto con el archivo
// original (subida directa al Storage via signed URL).
// Desde Fase 2: nombre, correo e institución son OBLIGATORIOS.
// ============================================================

import { extractText } from "../shared/extract.js";
import { fillCountrySelect } from "../shared/countries.js";
import { fillPhasesCheckboxes, readPhasesCheckboxes } from "../shared/phases.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../shared/config.js";

const form = document.getElementById("submit-form");
const fileInput = document.getElementById("f-file");
const countryOriginSelect = document.getElementById("f-country-origin");
const countryApplicableSelect = document.getElementById("f-country-applicable");
const descriptionInput = document.getElementById("f-description");
const phasesContainer = document.getElementById("f-phases");
const nameInput = document.getElementById("f-name");
const emailInput = document.getElementById("f-email");
const institutionInput = document.getElementById("f-institution");
const submitBtn = document.getElementById("submit-btn");
const statusEl = document.getElementById("submit-status");

fillCountrySelect(countryOriginSelect, { placeholder: "Selecciona un país" });
fillCountrySelect(countryApplicableSelect, {
  placeholder: "Selecciona una opción",
  includeGeneral: true,
  generalLabel: "General / aplica a varios países",
});
fillPhasesCheckboxes(phasesContainer);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = type ? type : "";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const file = fileInput.files[0];
  if (!file) return;

  // Validaciones del cliente
  const name = nameInput.value.trim();
  const email = emailInput.value.trim();
  const institution = institutionInput.value.trim();

  if (!name) { setStatus("Por favor ingresa tu nombre.", "error"); return; }
  if (!email || !EMAIL_RE.test(email)) {
    setStatus("Por favor ingresa un correo electrónico válido.", "error");
    return;
  }
  if (!institution) {
    setStatus("Por favor ingresa la institución a la que perteneces.", "error");
    return;
  }

  submitBtn.disabled = true;
  setStatus("Procesando archivo en tu navegador...", "hint");

  try {
    const text = await extractText(file);
    if (!text || !text.trim()) {
      throw new Error("No se pudo extraer texto del archivo.");
    }

    setStatus("Enviando documento...", "hint");

    const { phases, phaseOther } = readPhasesCheckboxes(phasesContainer);

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
        phases: phases.length > 0 ? phases : undefined,
        phase_other: phaseOther || undefined,
        submitter_name: name,
        submitter_email: email,
        submitter_institution: institution,
      }),
    });

    const result = await res.json();
    if (!res.ok || result.error) {
      throw new Error(result.error || "Ocurrió un error al enviar el documento.");
    }

    // Subir el archivo original directamente al Storage (para descarga futura)
    if (result.upload_url) {
      setStatus("Subiendo archivo original...", "hint");
      try {
        await fetch(result.upload_url, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type || "application/octet-stream" },
        });
      } catch {
        // La subida del archivo original falló pero el documento fue recibido;
        // el admin podrá adjuntarlo desde el panel de administración.
      }
    }

    setStatus(
      "¡Gracias! Tu documento fue recibido y será revisado por el equipo del COE. " +
        "Te avisaremos por correo cuando sea revisado.",
      "success",
    );
    form.reset();
    fillCountrySelect(countryOriginSelect, { placeholder: "Selecciona un país" });
    fillCountrySelect(countryApplicableSelect, {
      placeholder: "Selecciona una opción",
      includeGeneral: true,
      generalLabel: "General / aplica a varios países",
    });
    fillPhasesCheckboxes(phasesContainer);
  } catch (err) {
    setStatus("Error: " + err.message, "error");
  } finally {
    submitBtn.disabled = false;
  }
});
