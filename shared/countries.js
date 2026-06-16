// Lista de países válidos para "país de procedencia" / "país al que aplica".
// Debe mantenerse igual a supabase/functions/_shared/countries.ts (backend).

// Países de la región que cubre el asistente (para el selector del widget
// y los filtros del chat).
export const REGION_COUNTRIES = [
  "Panamá",
  "Costa Rica",
  "Nicaragua",
  "Honduras",
  "El Salvador",
  "Guatemala",
  "Belice",
  "República Dominicana",
];

export const REGIONAL_LABEL = "Toda la región (Centroamérica y República Dominicana)";

// Rellena un select con los países de la región + opción "Toda la región".
export function fillRegionSelect(select) {
  select.innerHTML = "";
  const allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = REGIONAL_LABEL;
  select.appendChild(allOpt);
  REGION_COUNTRIES.forEach((country) => {
    const opt = document.createElement("option");
    opt.value = country;
    opt.textContent = country;
    select.appendChild(opt);
  });
}

export const COUNTRIES = [
  "Panamá",
  "Costa Rica",
  "Nicaragua",
  "Honduras",
  "El Salvador",
  "Guatemala",
  "Belice",
  "México",
  "Colombia",
  "Venezuela",
  "Ecuador",
  "Perú",
  "Bolivia",
  "Chile",
  "Argentina",
  "Paraguay",
  "Uruguay",
  "Brasil",
  "República Dominicana",
  "Cuba",
  "España",
  "Estados Unidos",
  "Internacional / organismo multilateral",
];

// Llena un <select> con la lista de países.
// - placeholder: texto de la primera opción deshabilitada (ej. "Selecciona un país")
// - includeGeneral: si es true, agrega una opción con value="" al inicio
//   (después del placeholder) para representar "general / aplica a todos los países"
export function fillCountrySelect(select, { placeholder, includeGeneral, generalLabel } = {}) {
  select.innerHTML = "";

  if (placeholder) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = placeholder;
    opt.disabled = true;
    opt.selected = true;
    select.appendChild(opt);
  }

  if (includeGeneral) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = generalLabel || "General / varios países";
    select.appendChild(opt);
  }

  COUNTRIES.forEach((country) => {
    const opt = document.createElement("option");
    opt.value = country;
    opt.textContent = country;
    select.appendChild(opt);
  });
}
