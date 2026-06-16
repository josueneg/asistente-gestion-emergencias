// ============================================================
// Sistema de Monitoreo de Emergencias — COE Centroamérica
// ============================================================

import { REGION_COUNTRIES } from "../shared/countries.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../shared/config.js";

// ── Constantes ──────────────────────────────────────────────
const REFRESH_MS  = 60_000;
const ALERTS_DAYS = 7;
const MAP_CENTER  = [11.5, -84.5];
const MAP_ZOOM    = 5;

const SEVERITY_CFG = {
  alto:  { color: "#dc2626", radius: 22, pulse: true,  fast: true,  z: 1000, label: "Alto" },
  medio: { color: "#d97706", radius: 17, pulse: true,  fast: false, z: 500,  label: "Medio" },
  bajo:  { color: "#16a34a", radius: 13, pulse: false, fast: false, z: 200,  label: "Bajo" },
  info:  { color: "#2563eb", radius: 11, pulse: false, fast: false, z: 100,  label: "Informativo" },
};

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

const COUNTRY_BOUNDS = {
  "Panamá":               [[6.87, -83.05], [9.65, -77.17]],
  "Costa Rica":           [[8.03, -85.95], [11.22, -82.56]],
  "Nicaragua":            [[10.71, -87.67], [15.03, -82.60]],
  "Honduras":             [[12.98, -89.35], [16.52, -83.15]],
  "El Salvador":          [[13.15, -90.10], [14.45, -87.68]],
  "Guatemala":            [[13.73, -92.23], [17.82, -88.22]],
  "Belice":               [[15.89, -89.23], [18.49, -87.48]],
  "República Dominicana": [[17.47, -72.01], [19.93, -68.32]],
};

const REGION_BOUNDS = L.latLngBounds([6.5, -92.5], [21.5, -66.5]);

// ── Estado global ────────────────────────────────────────────
let map             = null;
let alertMarkers    = [];
let stationMarkers  = [];
let allAlerts       = [];
let allStations     = [];
let selectedCountry = "";
let refreshTimer    = null;
let countdownTimer  = null;
let secondsLeft     = REFRESH_MS / 1000;
let prevActiveIds   = new Set();

// Highlight de país
let activeHighlight = null;
let highlightTimer  = null;

// Capas DEM / meteorológicas
let hillshadeLayer = null;
let hillshadeOn    = false;

let rvHost      = "https://tilecache.rainviewer.com";
let rvFrames    = [];
let rvPastCount = 0;
let rvLayers    = [];
let rvFrame     = -1;
let rvActive    = null;
let rvPlaying   = false;
let rvTimer     = null;
let radarOn     = false;

let irLayer = null;
let irOn    = false;

let goesLayer = null;
let goesOn    = false;

// Geocodificación inversa
const geocodeCache = new Map();
const geocodeQueue = [];
let   geocoding    = false;

// ── DOM refs ─────────────────────────────────────────────────
const countrySelect    = document.getElementById("country-select");
const alertsList       = document.getElementById("alerts-list");
const emptyState       = document.getElementById("empty-state");
const totalBadge       = document.getElementById("total-badge");
const countAlto        = document.getElementById("count-alto");
const countMedio       = document.getElementById("count-medio");
const countBajo        = document.getElementById("count-bajo");
const countInfo        = document.getElementById("count-info");
const liveClock        = document.getElementById("live-clock");
const refreshStatus    = document.getElementById("refresh-status");
const lastUpdatedText  = document.getElementById("last-updated-text");
const refreshNowBtn    = document.getElementById("refresh-now-btn");
const resetViewBtn     = document.getElementById("reset-view-btn");

const metControls    = document.getElementById("met-controls");
const frameSlider    = document.getElementById("frame-slider");
const frameTimeEl    = document.getElementById("frame-time-label");
const prevFrameBtn   = document.getElementById("prev-frame-btn");
const playBtn        = document.getElementById("play-btn");
const nextFrameBtn   = document.getElementById("next-frame-btn");

const toggleHillshade = document.getElementById("toggle-hillshade");
const toggleRadar     = document.getElementById("toggle-radar");
const toggleInfrared  = document.getElementById("toggle-infrared");
const toggleGoes      = document.getElementById("toggle-goes");

const historySection   = document.getElementById("history-section");
const historyToggleBtn = document.getElementById("history-toggle-btn");
const historyList      = document.getElementById("history-list");
const historyBadge     = document.getElementById("history-count-badge");
const histChevron      = document.querySelector(".hist-chevron");

const mascotSpeech    = document.getElementById("mascot-speech");
const mascotSpeechTxt = document.getElementById("mascot-speech-text");
const mascotIcon      = document.getElementById("mascot-icon");

// ── Mapa ─────────────────────────────────────────────────────
function initMap() {
  map = L.map("map", { center: MAP_CENTER, zoom: MAP_ZOOM, zoomControl: true });

  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 18,
    },
  ).addTo(map);

  map.fitBounds(REGION_BOUNDS, { padding: [10, 10] });
  initOverlays();
}

// ── Capas DEM / GOES ─────────────────────────────────────────
function initOverlays() {
  hillshadeLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
    {
      attribution: '&copy; <a href="https://www.esri.com">ESRI</a> World Hillshade',
      maxZoom: 13,
      opacity: 0.4,
      zIndex: 200,
    },
  );
}

// Hora reciente para tiles GOES en NASA GIBS (90 min de retraso, cada 10 min)
function goesTime() {
  const d = new Date(Date.now() - 90 * 60 * 1000);
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 10) * 10);
  return d.toISOString().replace(".000Z", "Z");
}

function makeGOESLayer() {
  return L.tileLayer(
    `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_MultiBand_GeoColor/default/${goesTime()}/GoogleMapsCompatible/{z}/{y}/{x}.jpg`,
    {
      attribution: '<a href="https://worldview.earthdata.nasa.gov">NASA GIBS</a> · GOES-East',
      maxZoom: 9,
      opacity: 0.82,
      zIndex: 350,
    },
  );
}

// ── RainViewer ───────────────────────────────────────────────
async function loadRainViewer() {
  try {
    const res  = await fetch("https://api.rainviewer.com/public/weather-maps.json");
    const data = await res.json();
    rvHost = data.host || rvHost;

    const past    = data.radar?.past    || [];
    const nowcast = data.radar?.nowcast || [];
    rvPastCount   = past.length;
    rvFrames      = [...past, ...nowcast];

    rvLayers = rvFrames.map(f =>
      L.tileLayer(`${rvHost}${f.path}/512/{z}/{x}/{y}/2/1_1.png`, {
        opacity: 0.65, maxZoom: 18, attribution: "&copy; RainViewer", zIndex: 400,
      }),
    );

    if (frameSlider && rvFrames.length > 0) {
      frameSlider.max   = rvFrames.length - 1;
      frameSlider.value = rvFrames.length - 1;
    }

    const irFrames = data.satellite?.infrared || [];
    if (irFrames.length > 0) {
      const latest = irFrames[irFrames.length - 1];
      irLayer = L.tileLayer(`${rvHost}${latest.path}/512/{z}/{x}/{y}/0/0_0.png`, {
        opacity: 0.45, maxZoom: 10, attribution: "&copy; RainViewer", zIndex: 300,
      });
    }

    if (toggleRadar)    toggleRadar.disabled    = rvLayers.length === 0;
    if (toggleInfrared) toggleInfrared.disabled = !irLayer;
  } catch (e) {
    console.warn("[RainViewer]", e);
  }
}

function setRadarFrame(idx) {
  if (idx < 0 || idx >= rvLayers.length) return;
  if (rvActive) map.removeLayer(rvActive);
  rvFrame  = idx;
  rvActive = rvLayers[idx];
  if (radarOn) rvActive.addTo(map);
  if (frameSlider) frameSlider.value = idx;
  if (frameTimeEl && rvFrames[idx]) {
    const t      = new Date(rvFrames[idx].time * 1000);
    const isNow  = idx >= rvPastCount;
    frameTimeEl.textContent = `🌧 ${t.toLocaleTimeString("es-PA", { hour: "2-digit", minute: "2-digit" })}${isNow ? " · pronóstico" : ""}`;
  }
}

function startAnimation() {
  rvPlaying = true;
  if (playBtn) playBtn.textContent = "⏸";
  function step() {
    if (!rvPlaying) return;
    setRadarFrame((rvFrame + 1) % rvLayers.length);
    rvTimer = setTimeout(step, 400);
  }
  step();
}

function stopAnimation() {
  rvPlaying = false;
  clearTimeout(rvTimer);
  if (playBtn) playBtn.textContent = "▶";
}

// ── Highlight de país ────────────────────────────────────────
function clearHighlight() {
  if (activeHighlight) { map.removeLayer(activeHighlight); activeHighlight = null; }
  clearTimeout(highlightTimer);
}

function highlightCountry(country, sev) {
  clearHighlight();
  const bounds = COUNTRY_BOUNDS[country];
  if (!bounds) return;
  const color = SEVERITY_CFG[severityClass(sev)]?.color || "#2563eb";
  activeHighlight = L.rectangle(bounds, {
    color,
    weight: 2.5,
    dashArray: "9 6",
    fillColor: color,
    fillOpacity: 0.1,
    opacity: 0.85,
    interactive: false,
  }).addTo(map);
  highlightTimer = setTimeout(clearHighlight, 12000);
}

// ── Geocodificación inversa (Nominatim) ──────────────────────
function queueGeocode(alertId, lat, lon) {
  if (geocodeCache.has(alertId)) return;
  geocodeQueue.push({ alertId, lat, lon });
  if (!geocoding) processGeocodeQueue();
}

async function processGeocodeQueue() {
  if (geocodeQueue.length === 0) { geocoding = false; return; }
  geocoding = true;
  const { alertId, lat, lon } = geocodeQueue.shift();
  try {
    const res  = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1&accept-language=es`,
      { headers: { "User-Agent": "COE-Emergencias-CA/1.0" } },
    );
    const data = await res.json();
    const a    = data.address || {};
    geocodeCache.set(alertId, {
      state:    a.state    || a.province || a.region || "",
      county:   a.county   || a.municipality || a.city_district || "",
      locality: a.suburb   || a.quarter || a.village || a.hamlet || a.town || a.city || "",
    });
  } catch {
    geocodeCache.set(alertId, null);
  }
  updateCardLocation(alertId);
  setTimeout(processGeocodeQueue, 1150); // 1 req/s Nominatim
}

function updateCardLocation(alertId) {
  const el  = document.getElementById(`loc-${alertId}`);
  const loc = geocodeCache.get(alertId);
  if (!el || !loc) return;
  const parts = [loc.state, loc.county, loc.locality].filter(Boolean);
  if (parts.length) {
    el.textContent = `📍 ${parts.join(" · ")}`;
    el.classList.remove("hidden");
  }
}

// ── Mascota ───────────────────────────────────────────────────
function updateMascot(activeAlerts) {
  if (!mascotSpeechTxt || !mascotIcon) return;
  const newOnes = activeAlerts.filter(a => !prevActiveIds.has(a.id));
  prevActiveIds  = new Set(activeAlerts.map(a => a.id));

  if (activeAlerts.length === 0) {
    mascotSpeechTxt.textContent = "Monitoreo activo. Sin alertas en este momento.";
  } else {
    const n       = activeAlerts.length;
    const hasAlto = activeAlerts.some(a => a.severity === "alto");
    mascotSpeechTxt.textContent = hasAlto
      ? `¡Atención! ${n} alerta${n > 1 ? "s" : ""} activa${n > 1 ? "s" : ""}. Se requiere monitoreo inmediato.`
      : `${n} alerta${n > 1 ? "s" : ""} activa${n > 1 ? "s" : ""} en la región. Mantenga el monitoreo.`;
  }

  if (newOnes.length > 0) {
    mascotIcon.classList.remove("mascot-alerting");
    void mascotIcon.offsetWidth; // forzar reflow para reiniciar animación
    mascotIcon.classList.add("mascot-alerting");
    setTimeout(() => mascotIcon.classList.remove("mascot-alerting"), 2200);
  }
}

// ── Reloj ────────────────────────────────────────────────────
function startClock() {
  function tick() {
    liveClock.textContent = new Date().toLocaleTimeString("es-PA", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  }
  tick();
  setInterval(tick, 1000);
}

function fillCountrySelect() {
  REGION_COUNTRIES.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c; opt.textContent = c;
    countrySelect.appendChild(opt);
  });
}

// ── Utilidades ───────────────────────────────────────────────
function headers() {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
}

function escHtml(str) {
  const d = document.createElement("div");
  d.textContent = str == null ? "" : String(str);
  return d.innerHTML;
}

function formatAgo(isoStr) {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "Hace un momento";
  if (mins < 60) return `Hace ${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `Hace ${h}h ${mins % 60}min`;
  return `Hace ${Math.floor(h / 24)} día${Math.floor(h / 24) > 1 ? "s" : ""}`;
}

function formatTime(isoStr) {
  const d = new Date(isoStr);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString("es-PA", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("es-PA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function validUntilTag(isoStr) {
  if (!isoStr) return "";
  const ms   = new Date(isoStr) - Date.now();
  if (ms < 0) return `<span class="vt vt-expired">Expirada</span>`;
  const mins = Math.ceil(ms / 60000);
  const cls  = mins < 60 ? "vt-urgent" : mins < 180 ? "vt-warn" : "vt-ok";
  return `<span class="vt ${cls}">⏱ Hasta ${formatTime(isoStr)}</span>`;
}

function validityPct(createdAt, validUntil) {
  const start = new Date(createdAt).getTime();
  const end   = new Date(validUntil).getTime();
  const now   = Date.now();
  if (now >= end) return 100;
  return Math.max(0, Math.min(100, Math.round(((now - start) / (end - start)) * 100)));
}

function severityClass(sev) {
  return SEVERITY_CFG[sev] ? sev : "info";
}

function isAlertActive(alert) {
  if (alert.valid_until) return new Date(alert.valid_until) > new Date();
  return Date.now() - new Date(alert.created_at).getTime() < 24 * 3600_000;
}

// ── Carga de datos ───────────────────────────────────────────
async function fetchAlerts() {
  const since = new Date(Date.now() - ALERTS_DAYS * 86400000).toISOString();
  let url = `${SUPABASE_URL}/rest/v1/alerts?select=*&created_at=gt.${since}&order=created_at.desc&limit=200`;
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

// ── Iconos ───────────────────────────────────────────────────
function makeAlertIcon(sev) {
  const cfg  = SEVERITY_CFG[sev] || SEVERITY_CFG.info;
  const size = cfg.radius * 2;
  return L.divIcon({
    className:   "coe-marker-wrap",
    html:        `<div class="coe-marker severity-${sev}${cfg.pulse ? " pulse" : ""}${cfg.fast ? " pulse-fast" : ""}" style="width:${size}px;height:${size}px"></div>`,
    iconSize:    [size, size],
    iconAnchor:  [cfg.radius, cfg.radius],
    popupAnchor: [0, -cfg.radius - 4],
  });
}

function makeStationIcon() {
  return L.divIcon({
    className: "coe-marker-wrap",
    html: '<div class="station-dot"></div>',
    iconSize: [9, 9], iconAnchor: [4, 4], popupAnchor: [0, -6],
  });
}

// ── Marcadores en el mapa ────────────────────────────────────
function clearMapMarkers() {
  alertMarkers.forEach(m => m.remove());
  stationMarkers.forEach(m => m.remove());
  alertMarkers = []; stationMarkers = [];
}

function renderMapMarkers(alerts, stations) {
  clearMapMarkers();

  stations.forEach(st => {
    if (!st.lat || !st.lon) return;
    stationMarkers.push(
      L.marker([st.lat, st.lon], { icon: makeStationIcon(), zIndexOffset: 0 })
        .bindPopup(`<div class="coe-popup">
          <div class="coe-popup-header"><div class="coe-popup-title">📡 ${escHtml(st.location_name)}</div></div>
          <div class="coe-popup-body"><div class="coe-popup-meta">
            🌧 Umbral lluvia: ${st.rain_threshold_mm_h} mm/h<br>
            💨 Umbral viento: ${st.wind_threshold_kmh} km/h
            ${st.country ? `<br>🌎 ${st.country}` : ""}
          </div></div></div>`, { maxWidth: 260 })
        .addTo(map),
    );
  });

  alerts.forEach(alert => {
    const sev = severityClass(alert.severity);
    const cfg = SEVERITY_CFG[sev];
    let lat = alert.lat, lon = alert.lon;
    if (!lat || !lon) {
      const c = COUNTRY_CENTROIDS[alert.country];
      if (c) { lat = c[0] + (Math.random() - 0.5) * 0.5; lon = c[1] + (Math.random() - 0.5) * 0.5; }
    }
    if (!lat || !lon) return;

    const m = L.marker([lat, lon], { icon: makeAlertIcon(sev), zIndexOffset: cfg.z })
      .bindPopup(`
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
              ${alert.valid_until ? `<br>⏱ Válido hasta ${formatTime(alert.valid_until)}` : ""}
            </div>
          </div>
        </div>`, { maxWidth: 300 })
      .addTo(map);

    m._alertId = alert.id;
    alertMarkers.push(m);
  });
}

// ── Tarjeta de alerta ─────────────────────────────────────────
function renderAlertCard(alert, historical = false) {
  const sev       = severityClass(alert.severity);
  const cfg       = SEVERITY_CFG[sev];
  const canLocate = alert.lat && alert.lon ? true : !!COUNTRY_CENTROIDS[alert.country];

  let validityHtml = "";
  if (alert.valid_until) {
    const pct      = validityPct(alert.created_at, alert.valid_until);
    const fillCls  = pct < 50 ? "fill-ok" : pct < 80 ? "fill-warning" : "fill-urgent";
    const remaining = Math.max(0, new Date(alert.valid_until) - Date.now());
    const remMins   = Math.ceil(remaining / 60000);
    const remLabel  = pct >= 100 ? "Expirada"
      : remMins > 60 ? `${Math.floor(remMins / 60)}h ${remMins % 60}min restantes`
      : `${remMins} min restantes`;
    validityHtml = `
      <div class="validity-wrap">
        <div class="validity-label">
          <span>Válido hasta ${formatTime(alert.valid_until)}</span>
          <span>${remLabel}</span>
        </div>
        <div class="validity-track">
          <div class="validity-fill ${fillCls}" style="width:${pct}%"></div>
        </div>
      </div>`;
  }

  const card = document.createElement("div");
  card.className  = `alert-card${historical ? " alert-card-hist" : ""}`;
  card.dataset.id = alert.id;
  card.innerHTML  = `
    <div class="alert-card-stripe stripe-${sev}"></div>
    <div class="alert-card-body">
      <div class="alert-card-top">
        <span class="sev-badge sev-${sev}">${cfg.label}</span>
        <span class="alert-card-country">${escHtml(alert.country || "")}</span>
        ${alert.valid_until ? validUntilTag(alert.valid_until) : ""}
      </div>
      <div class="alert-card-title">${escHtml(alert.title)}</div>
      <div class="alert-location hidden" id="loc-${alert.id}"></div>
      <div class="alert-card-msg">${escHtml(alert.message || "")}</div>
      <div class="alert-card-meta">
        <div class="meta-row"><span class="meta-icon">🕐</span>${formatAgo(alert.created_at)}</div>
        ${alert.type ? `<div class="meta-row"><span class="meta-icon">📌</span>${escHtml(alert.type)}</div>` : ""}
      </div>
      ${validityHtml}
      ${canLocate && !historical ? `<button class="map-link-btn" data-id="${escHtml(String(alert.id))}">📍 Ver en mapa</button>` : ""}
    </div>`;
  return card;
}

// ── Lista de alertas activas + historial ─────────────────────
function renderAlertsList(alerts) {
  const active  = alerts.filter(isAlertActive);
  const history = alerts.filter(a => !isAlertActive(a));

  // Alertas activas
  alertsList.innerHTML = "";
  if (active.length === 0) {
    alertsList.appendChild(emptyState);
    emptyState.classList.remove("hidden");
  } else {
    const order  = { alto: 0, medio: 1, bajo: 2, info: 3 };
    const sorted = [...active].sort((a, b) => {
      const sa = order[a.severity] ?? 4, sb = order[b.severity] ?? 4;
      if (sa !== sb) return sa - sb;
      return new Date(b.created_at) - new Date(a.created_at);
    });
    sorted.forEach(a => alertsList.appendChild(renderAlertCard(a)));
  }

  // Historial (alertas expiradas / antiguas)
  if (!historySection || !historyList || !historyBadge) return;
  if (history.length === 0) {
    historySection.classList.add("hidden");
  } else {
    historyBadge.textContent = history.length;
    historySection.classList.remove("hidden");
    historyList.innerHTML = "";
    history.forEach(a => historyList.appendChild(renderAlertCard(a, true)));
  }

  // Geocodificar alertas con coordenadas exactas
  alerts.forEach(a => { if (a.lat && a.lon) queueGeocode(a.id, a.lat, a.lon); });

  updateMascot(active);
}

// ── Contadores header ────────────────────────────────────────
function updateStats(alerts) {
  const active = alerts.filter(isAlertActive);
  const counts = { alto: 0, medio: 0, bajo: 0, info: 0 };
  active.forEach(a => { if (counts[a.severity] !== undefined) counts[a.severity]++; });
  countAlto.textContent  = counts.alto;
  countMedio.textContent = counts.medio;
  countBajo.textContent  = counts.bajo;
  countInfo.textContent  = counts.info;
  totalBadge.textContent = active.length;
}

// ── Clic "Ver en mapa" ────────────────────────────────────────
alertsList.addEventListener("click", (e) => {
  const btn = e.target.closest(".map-link-btn");
  if (!btn) return;
  const id    = btn.dataset.id;
  const alert = allAlerts.find(a => String(a.id) === id);
  const m     = alertMarkers.find(mk => String(mk._alertId) === id);

  if (alert?.country) highlightCountry(alert.country, alert.severity);

  if (alert?.country && COUNTRY_BOUNDS[alert.country]) {
    map.fitBounds(COUNTRY_BOUNDS[alert.country], { padding: [50, 50], duration: 1.2 });
    setTimeout(() => { if (m) m.openPopup(); }, 1300);
  } else if (m) {
    map.flyTo(m.getLatLng(), 8, { duration: 1 });
    setTimeout(() => m.openPopup(), 1100);
  } else {
    const centroid = alert && COUNTRY_CENTROIDS[alert.country];
    if (centroid) map.flyTo(centroid, 7, { duration: 1 });
  }
});

// ── Historial toggle ─────────────────────────────────────────
historyToggleBtn?.addEventListener("click", () => {
  const open = !historyList.classList.contains("hidden");
  historyList.classList.toggle("hidden");
  if (histChevron) histChevron.textContent = open ? "▾" : "▴";
});

// ── Refresco ─────────────────────────────────────────────────
function startCountdown() {
  clearInterval(countdownTimer);
  secondsLeft    = Math.floor(REFRESH_MS / 1000);
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

// ── Vista por país ───────────────────────────────────────────
function flyToCountry(country) {
  if (!country) {
    map.fitBounds(REGION_BOUNDS, { padding: [10, 10], duration: 1 });
  } else {
    const b = COUNTRY_BOUNDS[country];
    if (b) map.fitBounds(b, { padding: [20, 20], duration: 1 });
    else {
      const c = COUNTRY_CENTROIDS[country];
      if (c) map.flyTo(c, 8, { duration: 1 });
    }
  }
}

function autoRefresh() {
  refresh();
  refreshTimer = setTimeout(autoRefresh, REFRESH_MS);
}

// ── Event listeners ──────────────────────────────────────────
countrySelect.addEventListener("change", () => {
  selectedCountry = countrySelect.value;
  clearHighlight();
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
  clearHighlight();
  flyToCountry("");
  refresh();
});

// Capas
toggleHillshade.addEventListener("change", (e) => {
  hillshadeOn = e.target.checked;
  if (hillshadeOn) hillshadeLayer.addTo(map);
  else if (map.hasLayer(hillshadeLayer)) map.removeLayer(hillshadeLayer);
});

toggleRadar.addEventListener("change", (e) => {
  radarOn = e.target.checked;
  if (radarOn) {
    metControls.classList.remove("hidden");
    if (rvFrame < 0 && rvLayers.length > 0) setRadarFrame(rvLayers.length - 1);
    else if (rvActive) rvActive.addTo(map);
  } else {
    stopAnimation();
    metControls.classList.add("hidden");
    if (rvActive && map.hasLayer(rvActive)) map.removeLayer(rvActive);
  }
});

toggleInfrared.addEventListener("change", (e) => {
  irOn = e.target.checked;
  if (irLayer) {
    if (irOn) irLayer.addTo(map);
    else if (map.hasLayer(irLayer)) map.removeLayer(irLayer);
  }
});

toggleGoes.addEventListener("change", (e) => {
  goesOn = e.target.checked;
  if (goesOn) {
    goesLayer = makeGOESLayer();
    goesLayer.addTo(map);
  } else if (goesLayer) {
    if (map.hasLayer(goesLayer)) map.removeLayer(goesLayer);
    goesLayer = null;
  }
});

// Controles radar
prevFrameBtn.addEventListener("click",  () => { stopAnimation(); setRadarFrame(Math.max(0, rvFrame - 1)); });
nextFrameBtn.addEventListener("click",  () => { stopAnimation(); setRadarFrame(Math.min(rvLayers.length - 1, rvFrame + 1)); });
playBtn.addEventListener("click",       () => { if (rvPlaying) stopAnimation(); else startAnimation(); });
frameSlider.addEventListener("input",   (e) => { stopAnimation(); setRadarFrame(parseInt(e.target.value, 10)); });

// ── Arranque ─────────────────────────────────────────────────
fillCountrySelect();
initMap();
startClock();
loadRainViewer();
refresh();
refreshTimer = setTimeout(autoRefresh, REFRESH_MS);
