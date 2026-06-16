// Fases del ciclo de gestión de riesgo de desastres (DRM).
// Debe mantenerse igual a supabase/functions/_shared/phases.ts (backend).
export const PHASES = [
  "Prevención",
  "Mitigación",
  "Preparación",
  "Desastre",
  "Respuesta",
  "Rehabilitación",
  "Recuperación",
  "Otro",
];

// Colores asociados a cada fase (para badges en la biblioteca).
export const PHASE_COLORS = {
  "Prevención": "#2e7d32",
  "Mitigación": "#1565c0",
  "Preparación": "#6a1b9a",
  "Desastre": "#b71c1c",
  "Respuesta": "#e65100",
  "Rehabilitación": "#f9a825",
  "Recuperación": "#00695c",
  "Otro": "#546e7a",
};

// Rellena un contenedor con checkboxes para selección múltiple de fases.
// selectedValues: array con las fases actualmente seleccionadas.
// Si "Otro" está marcado y otherValue existe, llena el campo de texto adjunto.
export function fillPhasesCheckboxes(container, selectedValues = [], otherValue = "") {
  container.innerHTML = "";
  PHASES.forEach((phase) => {
    const label = document.createElement("label");
    label.className = "phase-check-label";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = phase;
    cb.name = "phases";
    cb.checked = selectedValues.includes(phase);
    label.appendChild(cb);
    label.appendChild(document.createTextNode(" " + phase));
    container.appendChild(label);

    if (phase === "Otro") {
      const otherInput = document.createElement("input");
      otherInput.type = "text";
      otherInput.className = "phase-other-input";
      otherInput.placeholder = "Especificar...";
      otherInput.value = otherValue || "";
      otherInput.style.display = cb.checked ? "inline-block" : "none";
      cb.addEventListener("change", () => {
        otherInput.style.display = cb.checked ? "inline-block" : "none";
      });
      container.appendChild(otherInput);
    }
  });
}

// Lee los valores seleccionados del contenedor llenado por fillPhasesCheckboxes.
// Retorna { phases: string[], phaseOther: string }
export function readPhasesCheckboxes(container) {
  const phases = [];
  container.querySelectorAll("input[type=checkbox]:checked").forEach((cb) => {
    phases.push(cb.value);
  });
  const otherInput = container.querySelector(".phase-other-input");
  const phaseOther = otherInput ? otherInput.value.trim() : "";
  return { phases, phaseOther };
}
