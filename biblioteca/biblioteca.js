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
import { PHASES, PHASE_COLORS } from "../shared/phases.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../shared/config.js";

const GENERAL_LABEL = "General / aplica a todos los países";

const filterSelect = document.getElementById("country-filter");
const phaseFilterSelect = document.getElementById("phase-filter");
const statusEl = document.getElementById("doc-status");
const listEl = document.getElementById("doc-list");

// Llenar filtro de país
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

// Llenar filtro de fases DRM
phaseFilterSelect.innerHTML = "";
const allPhaseOpt = document.createElement("option");
allPhaseOpt.value = "";
allPhaseOpt.textContent = "Todas las secciones";
phaseFilterSelect.appendChild(allPhaseOpt);
PHASES.forEach((phase) => {
  const opt = document.createElement("option");
  opt.value = phase;
  opt.textContent = phase;
  phaseFilterSelect.appendChild(opt);
});

// Pre-seleccionar país desde ?pais=
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
    const fields = [
      "id",
      "filename",
      "title",
      "description",
      "country_origin",
      "country_applicable",
      "uploaded_at",
      "publication_date",
      "institutions",
      "validity_start_year",
      "validity_end_year",
      "phases",
      "phase_other",
      "storage_path",
    ].join(",");
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/documents?select=${fields}&approval_status=eq.approved&order=uploaded_at.desc`,
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

async function downloadDocument(docId) {
  const res = await fetch(
    `${SUPABASE_URL}/functions/v1/download-document?document_id=${encodeURIComponent(docId)}`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    },
  );
  const data = await res.json();
  if (!res.ok || data.error) {
    alert("Error al obtener enlace de descarga: " + (data.error || "desconocido"));
    return;
  }
  window.open(data.url, "_blank");
}

function renderPhaseBadges(phases, phaseOther) {
  if (!phases || phases.length === 0) return "";
  return phases
    .map((phase) => {
      const color = PHASE_COLORS[phase] || "#546e7a";
      const label = phase === "Otro" && phaseOther ? `Otro: ${phaseOther}` : phase;
      return `<span class="phase-badge" style="background:${color}">${escapeHtml(label)}</span>`;
    })
    .join("");
}

function render() {
  const countryFilter = filterSelect.value;
  const phaseFilter = phaseFilterSelect.value;

  let filtered = allDocs;
  if (countryFilter) {
    filtered = filtered.filter(
      (d) => !d.country_applicable || d.country_applicable === countryFilter,
    );
  }
  if (phaseFilter) {
    filtered = filtered.filter(
      (d) => Array.isArray(d.phases) && d.phases.includes(phaseFilter),
    );
  }

  listEl.innerHTML = "";

  if (filtered.length === 0) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent =
      countryFilter || phaseFilter
        ? "No hay documentos aprobados para los filtros seleccionados."
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
      const displayName = doc.title || doc.filename;
      const subName = doc.title && doc.title !== doc.filename ? doc.filename : "";

      let vigencia = "";
      if (doc.validity_start_year && doc.validity_end_year) {
        vigencia = `Vigencia: ${doc.validity_start_year}–${doc.validity_end_year}`;
      } else if (doc.validity_start_year) {
        vigencia = `Vigencia desde: ${doc.validity_start_year}`;
      } else if (doc.validity_end_year) {
        vigencia = `Vigencia hasta: ${doc.validity_end_year}`;
      }

      const item = document.createElement("div");
      item.className = "doc-item";
      item.innerHTML = `
        <h3>${escapeHtml(displayName)}</h3>
        ${subName ? `<p class="hint">${escapeHtml(subName)}</p>` : ""}
        ${doc.description ? `<p>${escapeHtml(doc.description)}</p>` : ""}
        ${doc.institutions ? `<p class="hint">Instituciones: ${escapeHtml(doc.institutions)}</p>` : ""}
        <div class="doc-meta">
          <span class="badge">Origen: ${escapeHtml(doc.country_origin || "—")}</span>
          ${doc.publication_date ? `<span>Publicado: ${formatDate(doc.publication_date)}</span>` : ""}
          ${vigencia ? `<span class="vigencia-badge">${escapeHtml(vigencia)}</span>` : ""}
          <span>Agregado: ${formatDate(doc.uploaded_at)}</span>
        </div>
        ${renderPhaseBadges(doc.phases, doc.phase_other)}
        ${doc.storage_path ? `<br><button class="doc-download-btn" data-id="${escapeHtml(doc.id)}">📥 Descargar</button>` : ""}
      `;
      list.appendChild(item);
    });

    section.appendChild(list);
    listEl.appendChild(section);
  });
}

listEl.addEventListener("click", async (e) => {
  const btn = e.target.closest(".doc-download-btn");
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = "Descargando...";
  await downloadDocument(btn.dataset.id);
  btn.disabled = false;
  btn.textContent = "📥 Descargar";
});

filterSelect.addEventListener("change", render);
phaseFilterSelect.addEventListener("change", render);

loadDocuments();
