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
import { fillPhasesCheckboxes, readPhasesCheckboxes } from "../shared/phases.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../shared/config.js";

const LS_WIDGET_URL = "coeAdmin.widgetUrl";

const supabaseUrl = SUPABASE_URL;
const supabaseAnonKey = SUPABASE_ANON_KEY;
let supabase = createClient(supabaseUrl, supabaseAnonKey);
let editDocId = null;

// ----------------------------------------------------------
// Referencias del DOM
// ----------------------------------------------------------
const loginSection = document.getElementById("login-section");
const appSection = document.getElementById("app-section");
const logoutBtn = document.getElementById("logout-btn");

const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");

const fileInput = document.getElementById("file-input");
const uploadBtn = document.getElementById("upload-btn");
const uploadStatus = document.getElementById("upload-status");
const textForm = document.getElementById("text-form");
const docCountryOrigin = document.getElementById("doc-country-origin");
const docCountryApplicable = document.getElementById("doc-country-applicable");
const docTitle = document.getElementById("doc-title");
const docPubDate = document.getElementById("doc-pub-date");
const docInstitutions = document.getElementById("doc-institutions");
const docValidityStart = document.getElementById("doc-validity-start");
const docValidityEnd = document.getElementById("doc-validity-end");
const docPhasesContainer = document.getElementById("doc-phases");
const docDescription = document.getElementById("doc-description");

// Edit modal
const editModal = document.getElementById("edit-modal");
const editForm = document.getElementById("edit-form");
const editTitle = document.getElementById("edit-title");
const editPubDate = document.getElementById("edit-pub-date");
const editInstitutions = document.getElementById("edit-institutions");
const editValidityStart = document.getElementById("edit-validity-start");
const editValidityEnd = document.getElementById("edit-validity-end");
const editPhasesContainer = document.getElementById("edit-phases");
const editCountryOrigin = document.getElementById("edit-country-origin");
const editCountryApplicable = document.getElementById("edit-country-applicable");
const editDescription = document.getElementById("edit-description");
const editFileStatus = document.getElementById("edit-file-status");
const editFileInput = document.getElementById("edit-file-input");
const editFileUploadStatus = document.getElementById("edit-file-upload-status");
const editStatus = document.getElementById("edit-status");
const editCancelBtn = document.getElementById("edit-cancel-btn");

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
fillCountrySelect(editCountryOrigin, {
  includeGeneral: true,
  generalLabel: "No especificado",
});
fillCountrySelect(editCountryApplicable, {
  includeGeneral: true,
  generalLabel: "General / aplica a todos los países",
});
fillPhasesCheckboxes(docPhasesContainer);
fillPhasesCheckboxes(editPhasesContainer);

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
  const { phases, phaseOther } = readPhasesCheckboxes(docPhasesContainer);
  return callFunction("ingest-document", {
    filename,
    mime_type: mimeType,
    text,
    country_origin: docCountryOrigin.value || undefined,
    country_applicable: docCountryApplicable.value || undefined,
    title: docTitle.value.trim() || undefined,
    publication_date: docPubDate.value || undefined,
    institutions: docInstitutions.value.trim() || undefined,
    validity_start_year: docValidityStart.value ? parseInt(docValidityStart.value, 10) : undefined,
    validity_end_year: docValidityEnd.value ? parseInt(docValidityEnd.value, 10) : undefined,
    phases: phases.length > 0 ? phases : undefined,
    phase_other: phaseOther || undefined,
    description: docDescription.value.trim() || undefined,
  });
}

// ----------------------------------------------------------
// Login / sesión
// ----------------------------------------------------------
function showLogin() {
  loginSection.classList.remove("hidden");
  appSection.classList.add("hidden");
  logoutBtn.classList.add("hidden");
}

function showApp() {
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
    const displayName = row.title || row.filename;
    const tr = document.createElement("tr");
    tr.dataset.id = row.id;
    tr.innerHTML = `
      <td>
        <strong>${escapeHtml(displayName)}</strong>
        ${row.title && row.title !== row.filename ? `<br><small class="hint">${escapeHtml(row.filename)}</small>` : ""}
        ${row.institutions ? `<br><small class="hint">${escapeHtml(row.institutions)}</small>` : ""}
        ${row.storage_path ? `<br><small style="color:#2a9d8f">✓ Archivo disponible para descarga</small>` : ""}
      </td>
      <td>${escapeHtml(country)}</td>
      <td><span class="badge ${approvalClass}">${approvalLabel}</span></td>
      <td>
        <span class="badge ${badgeClass}">${escapeHtml(row.status)}</span>
        ${row.error_message ? `<br><small>${escapeHtml(row.error_message)}</small>` : ""}
      </td>
      <td>${formatDate(row.uploaded_at)}</td>
      <td class="row-actions">
        <button data-action="edit">Editar</button>
        <button data-action="delete" class="secondary">Eliminar</button>
      </td>
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
    .select("*, document_submissions(submitter_name, submitter_email, submitter_institution)")
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
            }${submission.submitter_institution ? ` · ${escapeHtml(submission.submitter_institution)}` : ""}</p>`
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
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const tr = btn.closest("tr");
  const id = tr.dataset.id;

  if (btn.dataset.action === "edit") {
    const { data, error } = await supabase.from("documents").select("*").eq("id", id).single();
    if (error || !data) { alert("No se pudo cargar el documento."); return; }
    openEditModal(data);
    return;
  }

  if (btn.dataset.action === "delete") {
    if (!confirm("¿Eliminar este documento y sus fragmentos indexados?")) return;
    await supabase.from("documents").delete().eq("id", id);
    loadDocuments();
  }
});

fileInput.addEventListener("change", () => {
  uploadBtn.classList.toggle("hidden", !fileInput.files[0]);
  uploadStatus.textContent = fileInput.files[0]
    ? `Archivo seleccionado: ${fileInput.files[0].name}. Completa los metadatos y haz clic en "Subir e indexar".`
    : "";
});

async function uploadSelectedFile() {
  const file = fileInput.files[0];
  if (!file) return;
  uploadBtn.disabled = true;
  uploadStatus.textContent = "Procesando archivo en el navegador...";
  try {
    const text = await extractText(file);
    if (!text || !text.trim()) {
      throw new Error("No se pudo extraer texto del archivo.");
    }
    uploadStatus.textContent = "Generando embeddings e indexando...";
    const result = await ingestDocument(file.name, file.type, text);
    if (result.error) throw new Error(result.error);

    if (result.upload_url) {
      uploadStatus.textContent = `Indexado (${result.chunks} fragmentos). Subiendo archivo original...`;
      try {
        await fetch(result.upload_url, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type || "application/octet-stream" },
        });
        uploadStatus.textContent = `Listo: "${file.name}" indexado y guardado para descarga (${result.chunks} fragmentos).`;
      } catch {
        uploadStatus.textContent = `Indexado (${result.chunks} fragmentos). Nota: el archivo no pudo guardarse para descarga.`;
      }
    } else {
      uploadStatus.textContent = `Listo: "${file.name}" agregado (${result.chunks} fragmentos).`;
    }

    fileInput.value = "";
    uploadBtn.classList.add("hidden");
    docTitle.value = "";
    docPubDate.value = "";
    docInstitutions.value = "";
    docValidityStart.value = "";
    docValidityEnd.value = "";
    docDescription.value = "";
    fillPhasesCheckboxes(docPhasesContainer);
    loadDocuments();
  } catch (err) {
    uploadStatus.textContent = "Error: " + err.message;
  } finally {
    uploadBtn.disabled = false;
  }
}

uploadBtn.addEventListener("click", uploadSelectedFile);

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
// Modal de edición de documentos
// ----------------------------------------------------------
function openEditModal(doc) {
  editDocId = doc.id;

  editTitle.value = doc.title || "";
  editPubDate.value = doc.publication_date || "";
  editInstitutions.value = doc.institutions || "";
  editValidityStart.value = doc.validity_start_year || "";
  editValidityEnd.value = doc.validity_end_year || "";
  editDescription.value = doc.description || "";
  editStatus.textContent = "";

  editCountryOrigin.value = doc.country_origin || "";
  editCountryApplicable.value = doc.country_applicable || "";

  fillPhasesCheckboxes(editPhasesContainer, doc.phases || [], doc.phase_other || "");

  editFileStatus.textContent = doc.storage_path
    ? `Archivo guardado: ${doc.storage_path.split("/").pop()}`
    : "No hay archivo descargable guardado aún.";
  editFileInput.value = "";
  editFileUploadStatus.textContent = "";

  editModal.showModal();
}

editForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!editDocId) return;

  const { phases, phaseOther } = readPhasesCheckboxes(editPhasesContainer);

  editStatus.textContent = "Guardando...";
  const result = await callFunction("update-document", {
    document_id: editDocId,
    title: editTitle.value.trim() || null,
    publication_date: editPubDate.value || null,
    institutions: editInstitutions.value.trim() || null,
    validity_start_year: editValidityStart.value ? parseInt(editValidityStart.value, 10) : null,
    validity_end_year: editValidityEnd.value ? parseInt(editValidityEnd.value, 10) : null,
    phases: phases.length > 0 ? phases : null,
    phase_other: phaseOther || null,
    country_origin: editCountryOrigin.value || null,
    country_applicable: editCountryApplicable.value || null,
    description: editDescription.value.trim() || null,
  });

  if (result.error) {
    editStatus.textContent = "Error: " + result.error;
    return;
  }

  editStatus.textContent = "Guardado correctamente.";
  loadDocuments();
  setTimeout(() => editModal.close(), 1000);
});

editFileInput.addEventListener("change", async () => {
  const file = editFileInput.files[0];
  if (!file || !editDocId) return;

  editFileUploadStatus.textContent = "Obteniendo URL de subida...";
  const result = await callFunction("update-document", {
    document_id: editDocId,
    request_upload_url: true,
    filename_for_upload: file.name,
  });

  if (result.error || !result.upload_url) {
    editFileUploadStatus.textContent = "Error al obtener URL de subida: " + (result.error || "sin URL");
    return;
  }

  editFileUploadStatus.textContent = "Subiendo archivo...";
  try {
    const putRes = await fetch(result.upload_url, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type || "application/octet-stream" },
    });
    if (!putRes.ok) throw new Error(`HTTP ${putRes.status}`);
    editFileUploadStatus.textContent = `✓ Archivo "${escapeHtml(file.name)}" subido correctamente.`;
    editFileStatus.textContent = `Archivo guardado: ${escapeHtml(file.name)}`;
  } catch (err) {
    editFileUploadStatus.textContent = "Error al subir el archivo: " + err.message;
  }
});

editCancelBtn.addEventListener("click", () => editModal.close());

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
checkSession();
