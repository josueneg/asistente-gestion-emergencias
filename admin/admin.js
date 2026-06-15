// ============================================================
// Panel de administración - Asistente de Gestión de Emergencias
// ============================================================
// Permite: subir documentos (PDF/Word/Excel/texto), revisar la
// bandeja de documentos enviados por el público, configurar las
// ubicaciones y umbrales de clima, ver el historial de alertas, y
// generar el <script> de embed para cada sitio.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractText } from "../shared/extract.js";
import { fillCountrySelect } from "../shared/countries.js";

const LS_URL = "coeAdmin.supabaseUrl";
const LS_ANON = "coeAdmin.supabaseAnonKey";
const LS_WIDGET_URL = "coeAdmin.widgetUrl";

let supabase = null;
let supabaseUrl = "";
let supabaseAnonKey = "";

// ----------------------------------------------------------
// Referencias del DOM
// ----------------------------------------------------------
const configSection = document.getElementById("config-section");
const loginSection = document.getElementById("login-section");
const appSection = document.getElementById("app-section");
const logoutBtn = document.getElementById("logout-btn");

const configForm = document.getElementById("config-form");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const changeConfigLink = document.getElementById("change-config-link");

const fileInput = document.getElementById("file-input");
const uploadStatus = document.getElementById("upload-status");
const textForm = document.getElementById("text-form");
const docCountryOrigin = document.getElementById("doc-country-origin");
const docCountryApplicable = document.getElementById("doc-country-applicable");
const docDescription = document.getElementById("doc-description");

const inboxList = document.getElementById("inbox-list");
const inboxStatus = document.getElementById("inbox-status");

const weatherForm = document.getElementById("weather-form");
const siteForm = document.getElementById("site-form");
const sCountry = document.getElementById("s-country");
const widgetUrlForm = document.getElementById("widget-url-form");
const widgetUrlInput = document.getElementById("widget-url-input");

fillCountrySelect(docCountryOrigin, {
  includeGeneral: true,
  generalLabel: "No especificado",
});
fillCountrySelect(docCountryApplicable, {
  includeGeneral: true,
  generalLabel: "General / aplica a todos los países",
});
fillCountrySelect(sCountry, {
  includeGeneral: true,
  generalLabel: "Sin país específico",
});

// ----------------------------------------------------------
// Utilidades
// ----------------------------------------------------------
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("es-PA", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ----------------------------------------------------------
// Llamadas a Edge Functions que requieren sesión (personal del COE)
// ----------------------------------------------------------
async function callFunction(name, body) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  const res = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function ingestDocument(filename, mimeType, text) {
  return callFunction("ingest-document", {
    filename,
    mime_type: mimeType,
    text,
    country_origin: docCountryOrigin.value || undefined,
    country_applicable: docCountryApplicable.value || undefined,
    description: docDescription.value.trim() || undefined,
  });
}

// ----------------------------------------------------------
// Configuración inicial / login
// ----------------------------------------------------------
function showConfig() {
  configSection.classList.remove("hidden");
  loginSection.classList.add("hidden");
  appSection.classList.add("hidden");
  logoutBtn.classList.add("hidden");
}

function showLogin() {
  configSection.classList.add("hidden");
  loginSection.classList.remove("hidden");
  appSection.classList.add("hidden");
  logoutBtn.classList.add("hidden");
}

function showApp() {
  configSection.classList.add("hidden");
  loginSection.classList.add("hidden");
  appSection.classList.remove("hidden");
  logoutBtn.classList.remove("hidden");

  widgetUrlInput.value = localStorage.getItem(LS_WIDGET_URL) || "";

  loadDocuments();
  loadInbox();
  loadWeatherConfig();
  loadAlerts();
  loadSites();
}

async function checkSession() {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    showApp();
  } else {
    showLogin();
  }
}

configForm.addEventListener("submit", (e) => {
  e.preventDefault();
  supabaseUrl = document.getElementById("cfg-url").value.trim().replace(/\/+$/, "");
  supabaseAnonKey = document.getElementById("cfg-anon").value.trim();
  localStorage.setItem(LS_URL, supabaseUrl);
  localStorage.setItem(LS_ANON, supabaseAnonKey);
  supabase = createClient(supabaseUrl, supabaseAnonKey);
  checkSession();
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.classList.add("hidden");
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    loginError.textContent = error.message;
    loginError.classList.remove("hidden");
    return;
  }
  showApp();
});

changeConfigLink.addEventListener("click", (e) => {
  e.preventDefault();
  localStorage.removeItem(LS_URL);
  localStorage.removeItem(LS_ANON);
  showConfig();
});

logoutBtn.addEventListener("click", async () => {
  await supabase.auth.signOut();
  showLogin();
});

// ----------------------------------------------------------
// Pestañas
// ----------------------------------------------------------
document.querySelectorAll("#tabs .tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#tabs .tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
  });
});

// ----------------------------------------------------------
// Documentos
// ----------------------------------------------------------
async function loadDocuments() {
  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .order("uploaded_at", { ascending: false });
  if (error) {
    console.error(error);
    return;
  }
  const tbody = document.querySelector("#documents-table tbody");
  tbody.innerHTML = "";
  (data ?? []).forEach((row) => {
    const badgeClass =
      row.status === "indexed" ? "badge-indexed" : row.status === "error" ? "badge-error" : "badge-pending";
    const approvalClass = row.approval_status === "approved" ? "badge-indexed" : "badge-pending";
    const approvalLabel = row.approval_status === "approved" ? "aprobado" : "pendiente";
    const country = `${row.country_origin || "—"} → ${row.country_applicable || "General"}`;
    const tr = document.createElement("tr");
    tr.dataset.id = row.id;
    tr.innerHTML = `
      <td>${escapeHtml(row.filename)}</td>
      <td>${escapeHtml(country)}</td>
      <td><span class="badge ${approvalClass}">${approvalLabel}</span></td>
      <td>
        <span class="badge ${badgeClass}">${escapeHtml(row.status)}</span>
        ${row.error_message ? `<br><small>${escapeHtml(row.error_message)}</small>` : ""}
      </td>
      <td>${formatDate(row.uploaded_at)}</td>
      <td class="row-actions"><button data-action="delete" class="secondary">Eliminar</button></td>
    `;
    tbody.appendChild(tr);
  });
}

// ----------------------------------------------------------
// Bandeja de entrada (documentos enviados por el público)
// ----------------------------------------------------------
async function loadInbox() {
  const { data, error } = await supabase
    .from("documents")
    .select("*, document_submissions(submitter_name, submitter_email)")
    .eq("approval_status", "pending")
    .order("uploaded_at", { ascending: true });
  if (error) {
    console.error(error);
    return;
  }

  inboxList.innerHTML = "";

  if (!data || data.length === 0) {
    inboxStatus.textContent = "No hay documentos pendientes de revisión.";
    return;
  }
  inboxStatus.textContent = `${data.length} documento(s) pendiente(s) de revisión.`;

  data.forEach((row) => {
    const submission = (row.document_submissions || [])[0];
    const country = `${row.country_origin || "—"} → ${row.country_applicable || "General"}`;
    const preview = (row.raw_text || "").slice(0, 600);
    const truncated = (row.raw_text || "").length > 600;

    const item = document.createElement("div");
    item.className = "card inbox-item";
    item.dataset.id = row.id;
    item.innerHTML = `
      <h3>${escapeHtml(row.filename)}</h3>
      <div class="doc-meta">
        <span class="badge">${escapeHtml(country)}</span>
        <span>Recibido: ${formatDate(row.uploaded_at)}</span>
      </div>
      ${row.description ? `<p>${escapeHtml(row.description)}</p>` : ""}
      ${
        submission
          ? `<p class="hint">Enviado por: ${escapeHtml(submission.submitter_name || "Anónimo")}${
              submission.submitter_email ? ` — ${escapeHtml(submission.submitter_email)}` : ""
            }</p>`
          : `<p class="hint">Enviado de forma anónima (sin datos de contacto).</p>`
      }
      <details>
        <summary>Vista previa del texto extraído</summary>
        <pre>${escapeHtml(preview)}${truncated ? "…" : ""}</pre>
      </details>
      <div class="row-actions">
        <button data-action="approve">✅ Aprobar</button>
        <button data-action="reject" class="secondary">❌ Rechazar</button>
      </div>
      <p class="item-status hint"></p>
    `;
    inboxList.appendChild(item);
  });
}

inboxList.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const item = btn.closest(".inbox-item");
  const id = item.dataset.id;
  const statusP = item.querySelector(".item-status");
  const buttons = item.querySelectorAll("button");

  if (btn.dataset.action === "approve") {
    buttons.forEach((b) => (b.disabled = true));
    statusP.textContent = "Aprobando e indexando...";
    const result = await callFunction("approve-document", { document_id: id });
    if (result.error) {
      statusP.textContent = "Error: " + result.error;
      buttons.forEach((b) => (b.disabled = false));
      return;
    }
    statusP.textContent = `Aprobado (${result.chunks} fragmentos indexados).`;
    loadInbox();
    loadDocuments();
  }

  if (btn.dataset.action === "reject") {
    const reason = prompt(
      "Motivo del rechazo (opcional, se incluirá en el correo a quien lo envió). Cancela para no rechazar.",
    );
    if (reason === null) return;
    if (!confirm("¿Rechazar y eliminar este documento por completo?")) return;

    buttons.forEach((b) => (b.disabled = true));
    statusP.textContent = "Rechazando y eliminando...";
    const result = await callFunction("reject-document", {
      document_id: id,
      reason: reason.trim() || undefined,
    });
    if (result.error) {
      statusP.textContent = "Error: " + result.error;
      buttons.forEach((b) => (b.disabled = false));
      return;
    }
    loadInbox();
    loadDocuments();
  }
});

document.querySelector("#documents-table tbody").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action='delete']");
  if (!btn) return;
  const tr = btn.closest("tr");
  if (!confirm("¿Eliminar este documento y sus fragmentos indexados?")) return;
  await supabase.from("documents").delete().eq("id", tr.dataset.id);
  loadDocuments();
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  uploadStatus.textContent = "Procesando archivo en el navegador...";
  try {
    const text = await extractText(file);
    if (!text || !text.trim()) {
      throw new Error("No se pudo extraer texto del archivo.");
    }
    uploadStatus.textContent = "Generando embeddings e indexando...";
    const result = await ingestDocument(file.name, file.type, text);
    if (result.error) throw new Error(result.error);
    uploadStatus.textContent = `Listo: "${file.name}" agregado (${result.chunks} fragmentos).`;
    loadDocuments();
  } catch (err) {
    uploadStatus.textContent = "Error: " + err.message;
  } finally {
    fileInput.value = "";
  }
});

textForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("text-title").value.trim();
  const content = document.getElementById("text-content").value.trim();
  if (!title || !content) return;
  try {
    const result = await ingestDocument(title, "text/plain", content);
    if (result.error) throw new Error(result.error);
    alert(`Agregado: "${title}" (${result.chunks} fragmentos).`);
    textForm.reset();
    loadDocuments();
  } catch (err) {
    alert("Error: " + err.message);
  }
});

// ----------------------------------------------------------
// Clima
// ----------------------------------------------------------
async function loadWeatherConfig() {
  const { data, error } = await supabase
    .from("weather_config")
    .select("*")
    .order("location_name");
  if (error) {
    console.error(error);
    return;
  }
  const tbody = document.querySelector("#weather-table tbody");
  tbody.innerHTML = "";
  (data ?? []).forEach((row) => {
    const tr = document.createElement("tr");
    tr.dataset.id = row.id;
    tr.innerHTML = `
      <td>${escapeHtml(row.location_name)}</td>
      <td><input type="number" step="any" value="${row.lat}" data-field="lat" style="width:90px"></td>
      <td><input type="number" step="any" value="${row.lon}" data-field="lon" style="width:90px"></td>
      <td><input type="number" step="any" value="${row.rain_threshold_mm_h}" data-field="rain_threshold_mm_h" style="width:70px"></td>
      <td><input type="number" step="any" value="${row.wind_threshold_kmh}" data-field="wind_threshold_kmh" style="width:70px"></td>
      <td><input type="checkbox" data-field="enabled" ${row.enabled ? "checked" : ""}></td>
      <td class="row-actions">
        <button data-action="save">Guardar</button>
        <button data-action="delete" class="secondary">Eliminar</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

document.querySelector("#weather-table tbody").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const tr = btn.closest("tr");
  const id = tr.dataset.id;

  if (btn.dataset.action === "delete") {
    if (!confirm("¿Eliminar esta ubicación del monitoreo de clima?")) return;
    await supabase.from("weather_config").delete().eq("id", id);
    loadWeatherConfig();
    return;
  }

  if (btn.dataset.action === "save") {
    const updates = {};
    tr.querySelectorAll("input").forEach((input) => {
      const field = input.dataset.field;
      updates[field] = input.type === "checkbox" ? input.checked : parseFloat(input.value);
    });
    const { error } = await supabase.from("weather_config").update(updates).eq("id", id);
    if (error) alert("Error: " + error.message);
    else alert("Guardado");
  }
});

weatherForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const row = {
    location_name: document.getElementById("w-name").value.trim(),
    lat: parseFloat(document.getElementById("w-lat").value),
    lon: parseFloat(document.getElementById("w-lon").value),
    rain_threshold_mm_h: parseFloat(document.getElementById("w-rain").value),
    wind_threshold_kmh: parseFloat(document.getElementById("w-wind").value),
  };
  const { error } = await supabase.from("weather_config").insert(row);
  if (error) {
    alert("Error: " + error.message);
    return;
  }
  weatherForm.reset();
  document.getElementById("w-rain").value = 10;
  document.getElementById("w-wind").value = 50;
  loadWeatherConfig();
});

// ----------------------------------------------------------
// Alertas
// ----------------------------------------------------------
async function loadAlerts() {
  const { data, error } = await supabase
    .from("alerts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error(error);
    return;
  }
  const tbody = document.querySelector("#alerts-table tbody");
  tbody.innerHTML = "";
  (data ?? []).forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatDate(row.created_at)}</td>
      <td>${escapeHtml(row.type)}</td>
      <td><span class="badge badge-${escapeHtml(row.severity)}">${escapeHtml(row.severity)}</span></td>
      <td>${escapeHtml(row.title)}</td>
      <td>${escapeHtml(row.message)}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ----------------------------------------------------------
// Sitios / embed
// ----------------------------------------------------------
function buildSnippet(siteKey, country) {
  const widgetUrl = localStorage.getItem(LS_WIDGET_URL) || "https://TU-PROYECTO.pages.dev/widget.js";
  const lines = [
    "<script",
    `  src="${widgetUrl}"`,
    `  data-supabase-url="${supabaseUrl}"`,
    `  data-supabase-anon-key="${supabaseAnonKey}"`,
    `  data-site-key="${siteKey}"`,
  ];
  if (country) {
    lines.push(`  data-country="${country}"`);
  }
  lines.push("></script>");
  return lines.join("\n");
}

async function loadSites() {
  const { data, error } = await supabase.from("sites").select("*").order("created_at");
  if (error) {
    console.error(error);
    return;
  }
  const tbody = document.querySelector("#sites-table tbody");
  tbody.innerHTML = "";
  (data ?? []).forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(row.name)}</td>
      <td>${escapeHtml(row.allowed_origin)}</td>
      <td>${escapeHtml(row.country || "—")}</td>
      <td><div class="snippet-box">${escapeHtml(buildSnippet(row.site_key, row.country))}</div></td>
    `;
    tbody.appendChild(tr);
  });
}

siteForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("s-name").value.trim();
  const allowed_origin = document.getElementById("s-origin").value.trim() || "*";
  const country = sCountry.value || null;
  const { error } = await supabase.from("sites").insert({ name, allowed_origin, country });
  if (error) {
    alert("Error: " + error.message);
    return;
  }
  siteForm.reset();
  document.getElementById("s-origin").value = "*";
  fillCountrySelect(sCountry, { includeGeneral: true, generalLabel: "Sin país específico" });
  loadSites();
});

widgetUrlForm.addEventListener("submit", (e) => {
  e.preventDefault();
  localStorage.setItem(LS_WIDGET_URL, widgetUrlInput.value.trim());
  loadSites();
});

// ----------------------------------------------------------
// Inicio
// ----------------------------------------------------------
(function init() {
  supabaseUrl = localStorage.getItem(LS_URL);
  supabaseAnonKey = localStorage.getItem(LS_ANON);
  if (!supabaseUrl || !supabaseAnonKey) {
    showConfig();
    return;
  }
  supabase = createClient(supabaseUrl, supabaseAnonKey);
  checkSession();
})();
