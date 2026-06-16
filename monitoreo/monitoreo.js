// ============================================================
// Sistema de Monitoreo de Emergencias — COE Centroamérica
// ============================================================

import { REGION_COUNTRIES, REGIONAL_LABEL } from "../shared/countries.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../shared/config.js";

// ── Constantes ──────────────────────────────────────────────
const REFRESH_MS   = 60_000;       // actualizar cada 60 segundos
const ALERTS_DAYS  = 7;            // alertas de los últimos 7 días
const MAP_CENTER   = [11.5, -84.5]; // centro de Centroamérica
const MAP_ZOOM     = 5;

const SEVERITY_CFG = {
  alto:  { color: "#dc2626", radius: 22, pulse: true,  fast: true,  z: 1000, label: "Alto" },
  medio: { color: "#d97706", radius: 17, pulse: true,  fast: false, z: 500,  label: "Medio" },
  bajo:  { color: "#16a34a", radius: 13, pulse: false, fast: false, z: 200,  label: "Bajo" },
  info:  { color: "#2563eb", radius: 11, pulse: false, fast: false, z: 100,  label: "Informativo" },
};

// Centroides de cada país para posicionar alertas sin coordenadas exactas
const COUNTRY_CENTROIDS = {
  "Panamá":               [8.9824,  -79.5199],
  "Costa Rica":           [9.7489,  -83.7534],
  "Nicaragua":            [12.8654, -85.2072],
  "Honduras":             [14.7990, -86.2419],
  "El Salvador":          [13.7942, -88.8965],
  "Guatemala":            [15.7835, -90.2308],
  "Belice":               [17.1899, -88.4976],
  "República Dominicana": [18.7357, -70.1627],
};

// Límites del mapa para mostrar toda la región
const REGION_BOUNDS = L.latLngBounds(
  [6.5, -92.5],  // SW
  [21.5, -66.5], // NE
);

// ── Estado ──────────────────────────────────────────────────
let map = null;
let alertMarkers     = [];
let stationMarkers   = [];
let allAlerts        = [];
let allStations      = [];
let selectedCountry  = "";
let refreshTimer     = null;
let countdownTimer   = null;
let secondsLeft      = REFRESH_MS / 1000;

// ── DOM refs ────────────────────────────────────────────────
const countrySelect     = document.getElementById("country-select");
const alertsList        = document.getElementById("alerts-list");
const emptyState        = document.getElementById("empty-state");
const totalBadge        = document.getElementById("total-badge");
const countAlto         = document.getElementById("count-alto");
const countMedio        = document.getElementById("count-medio");
const countBajo         = document.getElementById("count-bajo");
const countInfo         = document.getElementById("count-info");
const liveClock         = document.getElementById("live-clock");
const refreshStatus     = document.getElementById("refresh-status");
const lastUpdatedText   = document.getElementById("last-updated-text");
const refreshNowBtn     = document.getElementById("refresh-now-btn");
const resetViewBtn      = document.getElementById("reset-view-btn");

// ── Inicialización del mapa ──────────────────────────────────
function initMap() {
  map = L.map("map", {
    center: MAP_CENTER,
    zoom: MAP_ZOOM,
    zoomControl: true,
    attributionControl: true,
  });

  // Tiles CartoDB Positron: limpios y profesionales
  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 18,
    },
  ).addTo(map);

  // Ajustar la vista a los límites de la región
  map.fitBounds(REGION_BOUNDS, { padding: [10, 10] });
}

// ── Reloj en tiempo real ─────────────────────────────────────
function startClock() {
  function tick() {
    const now = new Date();
    liveClock.textContent = now.toLocaleTimeString("es-PA", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  tick();
  setInterval(tick, 1000);
}

// ── Selector de país ─────────────────────────────────────────
function fillCountrySelect() {
  REGION_COUNTRIES.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    countrySelect.appendChild(opt);
  });
}

// ── Utilidades ───────────────────────────────────────────────
function headers() {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  };
}

function formatAgo(isoStr) {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "Hace un momento";
  if (mins < 60) return `Hace ${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `Hace ${h}h ${mins % 60}min`;
  return `Hace ${Math.floor(h / 24)} días`;
}

function formatTime(isoStr) {
  return new Date(isoStr).toLocaleTimeString("es-PA", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });
}

function validityPct(createdAt, validUntil) {
  const start = new Date(createdAt).getTime();
  const end   = new Date(validUntil).getTime();
  const now   = Date.now();
  if (now >= end) return 100;
  const total   = end - start;
  const elapsed = now - start;
  return Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
}

function severityClass(sev) {
  return SEVERITY_CFG[sev] ? sev : "info";
}

// ── Carga de datos ───────────────────────────────────────────
async function fetchAlerts() {
  const since = new Date(Date.now() - ALERTS_DAYS * 86400000).toISOString();
  let url = `${SUPABASE_URL}/rest/v1/alerts?select=*&created_at=gt.${since}&order=created_at.desc&limit=100`;
  if (selectedCountry) url += `&country=eq.${encodeURIComponent(selectedCountry)}`;

  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchStations() {
  let url = `${SUPABASE_URL}/rest/v1/weather_config?select=*&enabled=eq.true`;
  if (selectedCountry) url += `&country=eq.${encodeURIComponent(selectedCountry)}`;

  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Icono personalizado para alertas ─────────────────────────
function makeAlertIcon(sev) {
  const cfg  = SEVERITY_CFG[sev] || SEVERITY_CFG.info;
  const size = cfg.radius * 2;
  const html = `
    <div class="coe-marker severity-${sev}${cfg.pulse ? " pulse" : ""}${cfg.fast ? " pulse-fast" : ""}"
         style="width:${size}px;height:${size}px"></div>`;
  return L.divIcon({
    className: "coe-marker-wrap",
    html,
    iconSize: [size, size],
    iconAnchor: [cfg.radius, cfg.radius],
    popupAnchor: [0, -cfg.radius - 4],
  });
}

function makeStationIcon() {
  return L.divIcon({
    className: "coe-marker-wrap",
    html: '<div class="station-dot"></div>',
    iconSize: [9, 9],
    iconAnchor: [4, 4],
    popupAnchor: [0, -6],
  });
}

// ── Renderizado de marcadores en el mapa ─────────────────────
function clearMapMarkers() {
  alertMarkers.forEach((m) => m.remove());
  stationMarkers.forEach((m) => m.remove());
  alertMarkers   = [];
  stationMarkers = [];
}

function renderMapMarkers(alerts, stations) {
  clearMapMarkers();

  // Estaciones de monitoreo (puntos grises pequeños)
  stations.forEach((st) => {
    if (!st.lat || !st.lon) return;
    const m = L.marker([st.lat, st.lon], { icon: makeStationIcon(), zIndexOffset: 0 })
      .bindPopup(
        `<div class="coe-popup">
          <div class="coe-popup-header">
            <div class="coe-popup-title">📡 ${escHtml(st.location_name)}</div>
          </div>
          <div class="coe-popup-body">
            <div class="coe-popup-meta">
              🌧 Umbral lluvia: ${st.rain_threshold_mm_h} mm/h<br>
              💨 Umbral viento: ${st.wind_threshold_kmh} km/h<br>
              ${st.country ? `🌎 ${st.country}` : ""}
            </div>
          </div>
        </div>`,
        { maxWidth: 260 },
      )
      .addTo(map);
    stationMarkers.push(m);
  });

  // Alertas activas
  alerts.forEach((alert) => {
    const sev = severityClass(alert.severity);
    const cfg = SEVERITY_CFG[sev];

    // Determinar coordenadas
    let lat = alert.lat;
    let lon = alert.lon;
    if (!lat || !lon) {
      const centroid = COUNTRY_CENTROIDS[alert.country];
      if (centroid) {
        // Pequeño jitter aleatorio para evitar que se apilen en el mismo punto
        lat = centroid[0] + (Math.random() - 0.5) * 0.5;
        lon = centroid[1] + (Math.random() - 0.5) * 0.5;
      }
    }
    if (!lat || !lon) return;

    const popup = `
      <div class="coe-popup">
        <div class="coe-popup-header">
          <span class="coe-popup-severity sev-${sev}">${cfg.label.toUpperCase()}</span>
          <div class="coe-popup-title">${escHtml(alert.title)}</div>
        </div>
        <div class="coe-popup-body">
          <p class="coe-popup-msg">${escHtml(alert.message || "")}</p>
          <div class="coe-popup-meta">
            🕐 ${formatTime(alert.created_at)}
            ${alert.country ? ` · 🌎 ${escHtml(alert.country)}` : ""}
            ${alert.valid_until ? `<br>⏳ Válido hasta ${formatTime(alert.valid_until)}` : ""}
          </div>
        </div>
      </div>`;

    const m = L.marker([lat, lon], {
      icon: makeAlertIcon(sev),
      zIndexOffset: cfg.z,
    })
      .bindPopup(popup, { maxWidth: 300 })
      .addTo(map);

    m._alertId = alert.id;
    alertMarkers.push(m);
  });
}

// ── Panel de alertas ─────────────────────────────────────────
function escHtml(str) {
  const d = document.createElement("div");
  d.textContent = str == null ? "" : String(str);
  return d.innerHTML;
}

function renderAlertCard(alert) {
  const sev     = severityClass(alert.severity);
  const cfg     = SEVERITY_CFG[sev];
  const hasCoords = alert.lat && alert.lon;
  const hasCentroid = !!COUNTRY_CENTROIDS[alert.country];
  const canLocate = hasCoords || hasCentroid;

  let validityHtml = "";
  if (alert.valid_until) {
    const pct      = validityPct(alert.created_at, alert.valid_until);
    const fillCls  = pct < 50 ? "fill-ok" : pct < 80 ? "fill-warning" : "fill-urgent";
    const remaining = Math.max(0, new Date(alert.valid_until) - Date.now());
    const remMins   = Math.ceil(remaining / 60000);
    const remLabel  = remMins > 60
      ? `${Math.floor(remMins / 60)}h ${remMins % 60}min restantes`
      : `${remMins} min restantes`;
    validityHtml = `
      <div class="validity-wrap">
        <div class="validity-label">
          <span>Válido hasta ${formatTime(alert.valid_until)}</span>
          <span>${pct < 100 ? remLabel : "Expirado"}</span>
        </div>
        <div class="validity-track">
          <div class="validity-fill ${fillCls}" style="width:${pct}%"></div>
        </div>
      </div>`;
  }

  const card = document.createElement("div");
  card.className = "alert-card";
  card.dataset.id = alert.id;
  card.innerHTML = `
    <div class="alert-card-stripe stripe-${sev}"></div>
    <div class="alert-card-body">
      <div class="alert-card-top">
        <span class="sev-badge sev-${sev}">${cfg.label}</span>
        <span class="alert-card-country">${escHtml(alert.country || "")}</span>
      </div>
      <div class="alert-card-title">${escHtml(alert.title)}</div>
      <div class="alert-card-msg">${escHtml(alert.message || "")}</div>
      <div class="alert-card-meta">
        <div class="meta-row"><span class="meta-icon">🕐</span>${formatAgo(alert.created_at)}</div>
        ${alert.type ? `<div class="meta-row"><span class="meta-icon">📌</span>${escHtml(alert.type)}</div>` : ""}
      </div>
      ${validityHtml}
      ${canLocate ? `<button class="map-link-btn" data-id="${escHtml(String(alert.id))}">📍 Ver en mapa</button>` : ""}
    </div>`;
  return card;
}

function renderAlertsList(alerts) {
  alertsList.innerHTML = "";

  if (alerts.length === 0) {
    alertsList.appendChild(emptyState);
    emptyState.classList.remove("hidden");
    return;
  }

  // Ordenar: alto primero, luego medio, bajo, info; dentro de cada grupo por fecha desc
  const order = { alto: 0, medio: 1, bajo: 2, info: 3 };
  const sorted = [...alerts].sort((a, b) => {
    const sa = order[a.severity] ?? 4;
    const sb = order[b.severity] ?? 4;
    if (sa !== sb) return sa - sb;
    return new Date(b.created_at) - new Date(a.created_at);
  });

  sorted.forEach((alert) => alertsList.appendChild(renderAlertCard(alert)));
}

// ── Contadores en el header ──────────────────────────────────
function updateStats(alerts) {
  const counts = { alto: 0, medio: 0, bajo: 0, info: 0 };
  alerts.forEach((a) => { if (counts[a.severity] !== undefined) counts[a.severity]++; });
  countAlto.textContent  = counts.alto;
  countMedio.textContent = counts.medio;
  countBajo.textContent  = counts.bajo;
  countInfo.textContent  = counts.info;
  totalBadge.textContent = alerts.length;
}

// ── Clic "Ver en mapa" ───────────────────────────────────────
alertsList.addEventListener("click", (e) => {
  const btn = e.target.closest(".map-link-btn");
  if (!btn) return;
  const id  = btn.dataset.id;
  const m   = alertMarkers.find((mk) => String(mk._alertId) === id);
  if (m) {
    map.flyTo(m.getLatLng(), 8, { duration: 1 });
    setTimeout(() => m.openPopup(), 1100);
  } else {
    // Fallback: centroide del país
    const alert   = allAlerts.find((a) => String(a.id) === id);
    const centroid = alert && COUNTRY_CENTROIDS[alert.country];
    if (centroid) map.flyTo(centroid, 7, { duration: 1 });
  }
});

// ── Refresco automático ──────────────────────────────────────
function startCountdown() {
  clearInterval(countdownTimer);
  secondsLeft = Math.floor(REFRESH_MS / 1000);
  countdownTimer = setInterval(() => {
    secondsLeft--;
    refreshStatus.textContent = `Actualiza en ${secondsLeft}s`;
    if (secondsLeft <= 0) clearInterval(countdownTimer);
  }, 1000);
}

async function refresh() {
  refreshStatus.textContent = "Actualizando…";
  clearInterval(countdownTimer);
  try {
    const [alerts, stations] = await Promise.all([fetchAlerts(), fetchStations()]);
    allAlerts   = alerts;
    allStations = stations;

    renderMapMarkers(alerts, stations);
    renderAlertsList(alerts);
    updateStats(alerts);

    const now = new Date().toLocaleTimeString("es-PA", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    lastUpdatedText.textContent = `Última actualización: ${now}`;
  } catch (err) {
    console.error("[Monitoreo]", err);
    refreshStatus.textContent = "Error al actualizar";
  }
  startCountdown();
}

// ── Vista al seleccionar país ────────────────────────────────
function flyToCountry(country) {
  if (!country) {
    map.fitBounds(REGION_BOUNDS, { padding: [10, 10], duration: 1 });
  } else {
    const c = COUNTRY_CENTROIDS[country];
    if (c) map.flyTo(c, 8, { duration: 1 });
  }
}

// ── Event listeners ──────────────────────────────────────────
countrySelect.addEventListener("change", () => {
  selectedCountry = countrySelect.value;
  flyToCountry(selectedCountry);
  refresh();
});

refreshNowBtn.addEventListener("click", () => {
  clearTimeout(refreshTimer);
  refresh();
  refreshTimer = setTimeout(autoRefresh, REFRESH_MS);
});

resetViewBtn.addEventListener("click", () => {
  countrySelect.value = "";
  selectedCountry = "";
  flyToCountry("");
  refresh();
});

function autoRefresh() {
  refresh();
  refreshTimer = setTimeout(autoRefresh, REFRESH_MS);
}

// ── Arranque ─────────────────────────────────────────────────
fillCountrySelect();
initMap();
startClock();
refresh();
refreshTimer = setTimeout(autoRefresh, REFRESH_MS);
