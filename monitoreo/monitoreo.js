// ============================================================
// Sistema de Monitoreo de Emergencias — COE Centroamérica
// ============================================================

import { REGION_COUNTRIES, REGIONAL_LABEL } from "../shared/countries.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../shared/config.js";

// ── Constantes ──────────────────────────────────────────────
const REFRESH_MS   = 60_000;
const ALERTS_DAYS  = 7;
const MAP_CENTER   = [11.5, -84.5];
const MAP_ZOOM     = 5;

const SEVERITY_CFG = {
  alto:  { color: "#dc2626", radius: 22, pulse: true,  fast: true,  z: 1000, label: "Alto" },
  medio: { color: "#d97706", radius: 17, pulse: true,  fast: false, z: 500,  label: "Medio" },
  bajo:  { color: "#16a34a", radius: 13, pulse: false, fast: false, z: 200,  label: "Bajo" },
  info:  { color: "#2563eb", radius: 11, pulse: false, fast: false, z: 100,  label: "Informativo" },
};

// Centroides para posicionar alertas sin coordenadas exactas
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

// Bounding boxes por país para resaltar la zona afectada
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

// Highlight de país
let activeHighlight = null;
let highlightTimer  = null;

// Capas DEM / meteorológicas
let hillshadeLayer  = null;
let hillshadeOn     = false;

let rvHost       = "https://tilecache.rainviewer.com";
let rvFrames     = [];      // [{time, path}]
let rvPastCount  = 0;
let rvLayers     = [];      // L.TileLayer[] por fotograma
let rvFrame      = -1;
let rvActive     = null;    // capa activa en el mapa
let rvPlaying    = false;
let rvTimer      = null;
let radarOn      = false;

let irLayer = null;
let irOn    = false;

// ── DOM refs ─────────────────────────────────────────────────
const countrySelect   = document.getElementById("country-select");
const alertsList      = document.getElementById("alerts-list");
const emptyState      = document.getElementById("empty-state");
const totalBadge      = document.getElementById("total-badge");
const countAlto       = document.getElementById("count-alto");
const countMedio      = document.getElementById("count-medio");
const countBajo       = document.getElementById("count-bajo");
const countInfo       = document.getElementById("count-info");
const liveClock       = document.getElementById("live-clock");
const refreshStatus   = document.getElementById("refresh-status");
const lastUpdatedText = document.getElementById("last-updated-text");
const refreshNowBtn   = document.getElementById("refresh-now-btn");
const resetViewBtn    = document.getElementById("reset-view-btn");

const metControls   = document.getElementById("met-controls");
const frameSlider   = document.getElementById("frame-slider");
const frameTimeEl   = document.getElementById("frame-time-label");
const prevFrameBtn  = document.getElementById("prev-frame-btn");
const playBtn       = document.getElementById("play-btn");
const nextFrameBtn  = document.getElementById("next-frame-btn");

const toggleHillshade = document.getElementById("toggle-hillshade");
const toggleRadar     = document.getElementById("toggle-radar");
const toggleInfrared  = document.getElementById("toggle-infrared");

// ── Inicialización del mapa ───────────────────────────────────
function initMap() {
  map = L.map("map", {
    center: MAP_CENTER,
    zoom: MAP_ZOOM,
    zoomControl: true,
    attributionControl: true,
  });

  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 18,
    },
  ).addTo(map);

  map.fitBounds(REGION_BOUNDS, { padding: [10, 10] });

  initOverlays();
}

// ── Capas DEM y meteorológicas ───────────────────────────────
function initOverlays() {
  // DEM / Hillshade — ESRI World Hillshade (gratuito, sin API key)
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

    // Capa de satélite infrarrojo (nubes)
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

// Activa un fotograma específico de radar
function setRadarFrame(idx) {
  if (idx < 0 || idx >= rvLayers.length) return;
  if (rvActive) map.removeLayer(rvActive);
  rvFrame  = idx;
  rvActive = rvLayers[idx];
  if (radarOn) rvActive.addTo(map);

  if (frameSlider) frameSlider.value = idx;
  if (frameTimeEl && rvFrames[idx]) {
    const t         = new Date(rvFrames[idx].time * 1000);
    const isNow     = idx >= rvPastCount;
    const timeStr   = t.toLocaleTimeString("es-PA", { hour: "2-digit", minute: "2-digit" });
    frameTimeEl.textContent = `🌧 ${timeStr}${isNow ? " · pronóstico" : ""}`;
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

// ── Highlight de país en el mapa ─────────────────────────────
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
    zIndex: 100,
  }).addTo(map);

  // Auto-desvanece tras 12 s
  highlightTimer = setTimeout(clearHighlight, 12000);
}

// ── Reloj en tiempo real ─────────────────────────────────────
function startClock() {
  function tick() {
    const now = new Date();
    liveClock.textContent = now.toLocaleTimeString("es-PA", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
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
  return `Hace ${Math.floor(h / 24)} días`;
}

function formatTime(isoStr) {
  return new Date(isoStr).toLocaleTimeString("es-PA", {
    hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit",
  });
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

// ── Iconos personalizados ────────────────────────────────────
function makeAlertIcon(sev) {
  const cfg  = SEVERITY_CFG[sev] || SEVERITY_CFG.info;
  const size = cfg.radius * 2;
  const html = `<div class="coe-marker severity-${sev}${cfg.pulse ? " pulse" : ""}${cfg.fast ? " pulse-fast" : ""}" style="width:${size}px;height:${size}px"></div>`;
  return L.divIcon({
    className:   "coe-marker-wrap",
    html,
    iconSize:    [size, size],
    iconAnchor:  [cfg.radius, cfg.radius],
    popupAnchor: [0, -cfg.radius - 4],
  });
}

function makeStationIcon() {
  return L.divIcon({
    className:   "coe-marker-wrap",
    html:        '<div class="station-dot"></div>',
    iconSize:    [9, 9],
    iconAnchor:  [4, 4],
    popupAnchor: [0, -6],
  });
}

// ── Marcadores en el mapa ────────────────────────────────────
function clearMapMarkers() {
  alertMarkers.forEach((m) => m.remove());
  stationMarkers.forEach((m) => m.remove());
  alertMarkers   = [];
  stationMarkers = [];
}

function renderMapMarkers(alerts, stations) {
  clearMapMarkers();

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

  alerts.forEach((alert) => {
    const sev = severityClass(alert.severity);
    const cfg = SEVERITY_CFG[sev];

    let lat = alert.lat;
    let lon = alert.lon;
    if (!lat || !lon) {
      const centroid = COUNTRY_CENTROIDS[alert.country];
      if (centroid) {
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

    const m = L.marker([lat, lon], { icon: makeAlertIcon(sev), zIndexOffset: cfg.z })
      .bindPopup(popup, { maxWidth: 300 })
      .addTo(map);

    m._alertId    = alert.id;
    m._alertCountry = alert.country;
    m._alertSev   = alert.severity;
    alertMarkers.push(m);
  });
}

// ── Panel de alertas ─────────────────────────────────────────
function renderAlertCard(alert) {
  const sev        = severityClass(alert.severity);
  const cfg        = SEVERITY_CFG[sev];
  const hasCoords  = alert.lat && alert.lon;
  const hasBounds  = !!COUNTRY_BOUNDS[alert.country];
  const canLocate  = hasCoords || !!COUNTRY_CENTROIDS[alert.country];

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
  card.className   = "alert-card";
  card.dataset.id  = alert.id;
  card.innerHTML   = `
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
  const order  = { alto: 0, medio: 1, bajo: 2, info: 3 };
  const sorted = [...alerts].sort((a, b) => {
    const sa = order[a.severity] ?? 4;
    const sb = order[b.severity] ?? 4;
    if (sa !== sb) return sa - sb;
    return new Date(b.created_at) - new Date(a.created_at);
  });
  sorted.forEach((alert) => alertsList.appendChild(renderAlertCard(alert)));
}

// ── Contadores header ────────────────────────────────────────
function updateStats(alerts) {
  const counts = { alto: 0, medio: 0, bajo: 0, info: 0 };
  alerts.forEach((a) => { if (counts[a.severity] !== undefined) counts[a.severity]++; });
  countAlto.textContent  = counts.alto;
  countMedio.textContent = counts.medio;
  countBajo.textContent  = counts.bajo;
  countInfo.textContent  = counts.info;
  totalBadge.textContent = alerts.length;
}

// ── Clic "Ver en mapa" → highlight + zoom ───────────────────
alertsList.addEventListener("click", (e) => {
  const btn = e.target.closest(".map-link-btn");
  if (!btn) return;
  const id    = btn.dataset.id;
  const alert = allAlerts.find((a) => String(a.id) === id);
  const m     = alertMarkers.find((mk) => String(mk._alertId) === id);

  // 1. Resaltar el país con bounding box coloreado
  if (alert?.country) highlightCountry(alert.country, alert.severity);

  // 2. Ajustar la vista: bounding box del país > centroide > coordenada exacta
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

// ── Refresco automático ──────────────────────────────────────
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

// ── Vista al seleccionar país ────────────────────────────────
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

// Capas — Relieve DEM
toggleHillshade.addEventListener("change", (e) => {
  hillshadeOn = e.target.checked;
  if (hillshadeOn) hillshadeLayer.addTo(map);
  else if (map.hasLayer(hillshadeLayer)) map.removeLayer(hillshadeLayer);
});

// Capas — Radar precipitación
toggleRadar.addEventListener("change", (e) => {
  radarOn = e.target.checked;
  if (radarOn) {
    metControls.classList.remove("hidden");
    if (rvFrame < 0 && rvLayers.length > 0) {
      setRadarFrame(rvLayers.length - 1);
    } else if (rvActive) {
      rvActive.addTo(map);
    }
  } else {
    stopAnimation();
    metControls.classList.add("hidden");
    if (rvActive && map.hasLayer(rvActive)) map.removeLayer(rvActive);
  }
});

// Capas — Satélite infrarrojo (nubes)
toggleInfrared.addEventListener("change", (e) => {
  irOn = e.target.checked;
  if (irLayer) {
    if (irOn) irLayer.addTo(map);
    else if (map.hasLayer(irLayer)) map.removeLayer(irLayer);
  }
});

// Controles de animación radar
prevFrameBtn.addEventListener("click", () => {
  stopAnimation();
  setRadarFrame(Math.max(0, rvFrame - 1));
});
nextFrameBtn.addEventListener("click", () => {
  stopAnimation();
  setRadarFrame(Math.min(rvLayers.length - 1, rvFrame + 1));
});
playBtn.addEventListener("click", () => {
  if (rvPlaying) stopAnimation(); else startAnimation();
});
frameSlider.addEventListener("input", (e) => {
  stopAnimation();
  setRadarFrame(parseInt(e.target.value, 10));
});

// ── Arranque ─────────────────────────────────────────────────
fillCountrySelect();
initMap();
startClock();
loadRainViewer();
refresh();
refreshTimer = setTimeout(autoRefresh, REFRESH_MS);
