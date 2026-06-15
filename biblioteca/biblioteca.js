// ============================================================
// Página pública "Biblioteca de documentos"
// ============================================================
// Muestra los documentos que el equipo del COE ya revisó y aprobó,
// agrupados por país al que aplican. Es la lista de fuentes que el
// asistente usa para responder preguntas y generar recomendaciones.
// Lectura pública vía PostgREST (RLS permite leer documentos con
// approval_status='approved').
// ============================================================

import { COUNTRIES } from "../shared/countries.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../shared/config.js";

const GENERAL_LABEL = "General / aplica a todos los países";

const filterSelect = document.getElementById("country-filter");
const statusEl = document.getElementById("doc-status");
const listEl = document.getElementById("doc-list");

filterSelect.innerHTML = "";
const allOpt = document.createElement("option");
allOpt.value = "";
allOpt.textContent = "Todos los países";
filterSelect.appendChild(allOpt);
COUNTRIES.forEach((country) => {
  const opt = document.createElement("option");
  opt.value = country;
  opt.textContent = country;
  filterSelect.appendChild(opt);
});

const params = new URLSearchParams(window.location.search);
const initialCountry = params.get("pais") || "";
if (initialCountry && COUNTRIES.includes(initialCountry)) {
  filterSelect.value = initialCountry;
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("es-PA", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

let allDocs = [];

async function loadDocuments() {
  statusEl.textContent = "Cargando documentos...";
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/documents?select=filename,description,country_origin,country_applicable,uploaded_at&approval_status=eq.approved&order=uploaded_at.desc`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allDocs = await res.json();
    statusEl.textContent = "";
    render();
  } catch (err) {
    statusEl.textContent = "Error al cargar la biblioteca: " + err.message;
  }
}

function render() {
  const filter = filterSelect.value;
  const filtered = filter
    ? allDocs.filter((d) => !d.country_applicable || d.country_applicable === filter)
    : allDocs;

  listEl.innerHTML = "";

  if (filtered.length === 0) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = filter
      ? `Todavía no hay documentos aprobados para ${filter}.`
      : "Todavía no hay documentos aprobados.";
    listEl.appendChild(p);
    return;
  }

  // Agrupar por país al que aplica (null -> "General")
  const groups = new Map();
  filtered.forEach((doc) => {
    const key = doc.country_applicable || GENERAL_LABEL;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(doc);
  });

  const keys = [...groups.keys()].sort((a, b) => {
    if (a === GENERAL_LABEL) return -1;
    if (b === GENERAL_LABEL) return 1;
    return a.localeCompare(b, "es");
  });

  keys.forEach((key) => {
    const section = document.createElement("div");
    section.className = "card country-group";

    const h2 = document.createElement("h2");
    h2.textContent = key;
    section.appendChild(h2);

    const list = document.createElement("div");
    list.className = "doc-list";

    groups.get(key).forEach((doc) => {
      const item = document.createElement("div");
      item.className = "doc-item";
      item.innerHTML = `
        <h3>${escapeHtml(doc.filename)}</h3>
        ${doc.description ? `<p>${escapeHtml(doc.description)}</p>` : ""}
        <div class="doc-meta">
          <span class="badge">Origen: ${escapeHtml(doc.country_origin || "—")}</span>
          <span>Agregado: ${formatDate(doc.uploaded_at)}</span>
        </div>
      `;
      list.appendChild(item);
    });

    section.appendChild(list);
    listEl.appendChild(section);
  });
}

filterSelect.addEventListener("change", render);

loadDocuments();
