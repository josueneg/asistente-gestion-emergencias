/**
 * Asistente de Gestión de Emergencias - widget embebible
 * ============================================================
 * Insertar en cualquier sitio web con:
 *
 *   <script src="https://TU-PROYECTO.pages.dev/widget.js"
 *     data-supabase-url="https://TU-PROYECTO.supabase.co"
 *     data-supabase-anon-key="TU_ANON_KEY"
 *     data-site-key="TU_SITE_KEY"
 *     data-country="Panamá"
 *   ></script>
 *
 * "data-country" es opcional: si se indica, el chat y las
 * recomendaciones se enfocan en los documentos aplicables a ese país
 * (además de los documentos "generales", sin país específico).
 *
 * No requiere ninguna librería externa. Crea su propia interfaz
 * (botón flotante + panel de chat) dentro de un Shadow DOM para
 * no chocar con los estilos del sitio anfitrión.
 *
 * Funciones:
 *  - Chat con RAG sobre los documentos aprobados del COE (Edge Function "chat")
 *  - Recomendaciones de mejora por país a partir de la biblioteca de documentos
 *  - Alertas en tiempo real (consulta periódica a la tabla "alerts")
 *  - Notificación visual (toast + Notification API del navegador)
 *  - Notificación hablada (Web Speech API, español)
 */
(function () {
  "use strict";

  var scriptEl = document.currentScript;
  if (!scriptEl) {
    var scripts = document.getElementsByTagName("script");
    scriptEl = scripts[scripts.length - 1];
  }

  var config = {
    supabaseUrl: (scriptEl.dataset.supabaseUrl || "").replace(/\/+$/, ""),
    anonKey: scriptEl.dataset.supabaseAnonKey || "",
    siteKey: scriptEl.dataset.siteKey || "",
    lang: scriptEl.dataset.lang || "es-ES",
    title: scriptEl.dataset.title || "Asistente de Gestión de Emergencias",
    pollMs: parseInt(scriptEl.dataset.pollMs || "60000", 10),
    country: scriptEl.dataset.country || "",
  };

  if (!config.supabaseUrl || !config.anonKey || !config.siteKey) {
    console.error(
      "[Asistente] Faltan atributos data-supabase-url, data-supabase-anon-key o data-site-key en el <script>.",
    );
    return;
  }

  var STORAGE_PREFIX = "coeAsistente.";
  var STORAGE_SESSION = STORAGE_PREFIX + "sessionId";
  var STORAGE_LAST_ALERT = STORAGE_PREFIX + "lastAlertCreatedAt";
  var STORAGE_VOICE = STORAGE_PREFIX + "voiceEnabled";
  var STORAGE_REGION = STORAGE_PREFIX + "selectedRegion";

  var REGION_COUNTRIES = [
    "Panamá", "Costa Rica", "Nicaragua", "Honduras",
    "El Salvador", "Guatemala", "Belice", "República Dominicana",
  ];
  var REGIONAL_LABEL = "Toda la región (Centroamérica y República Dominicana)";

  var introShown = false;

  function getSessionId() {
    var id = localStorage.getItem(STORAGE_SESSION);
    if (!id) {
      id = "sess_" + Math.random().toString(36).slice(2) + "_" + Date.now();
      localStorage.setItem(STORAGE_SESSION, id);
    }
    return id;
  }

  function isVoiceEnabled() {
    return localStorage.getItem(STORAGE_VOICE) !== "off";
  }

  function setVoiceEnabled(enabled) {
    localStorage.setItem(STORAGE_VOICE, enabled ? "on" : "off");
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  // ----------------------------------------------------------
  // Estilos (Shadow DOM, no afectan ni son afectados por el sitio)
  // ----------------------------------------------------------
  var CSS = ""
    + ":host { all: initial; }"
    + "* { box-sizing: border-box; font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; }"
    + ".coe-fab {"
    + "  position: fixed; bottom: 20px; right: 20px; width: 60px; height: 60px;"
    + "  border-radius: 50%; background: #0b4f6c; color: #fff; border: none;"
    + "  font-size: 26px; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.25);"
    + "  z-index: 2147483000; display: flex; align-items: center; justify-content: center;"
    + "}"
    + ".coe-fab:hover { background: #0d6986; }"
    + ".coe-badge {"
    + "  position: absolute; top: -4px; right: -4px; background: #e63946; color: #fff;"
    + "  border-radius: 999px; font-size: 11px; font-weight: 700; min-width: 18px; height: 18px;"
    + "  display: flex; align-items: center; justify-content: center; padding: 0 4px;"
    + "}"
    + ".coe-panel {"
    + "  position: fixed; bottom: 90px; right: 20px; width: 340px; max-width: calc(100vw - 24px);"
    + "  height: 460px; max-height: calc(100vh - 110px); background: #fff; border-radius: 12px;"
    + "  box-shadow: 0 8px 30px rgba(0,0,0,.25); display: none; flex-direction: column; overflow: hidden;"
    + "  z-index: 2147483000;"
    + "}"
    + ".coe-panel.coe-open { display: flex; }"
    + ".coe-header {"
    + "  background: #0b4f6c; color: #fff; padding: 10px 12px; display: flex; align-items: center;"
    + "  justify-content: space-between; font-weight: 600; font-size: 14px;"
    + "}"
    + ".coe-header-actions button {"
    + "  background: transparent; border: none; color: #fff; font-size: 16px; cursor: pointer; margin-left: 6px;"
    + "  opacity: .9;"
    + "}"
    + ".coe-header-actions button:hover { opacity: 1; }"
    + ".coe-feed {"
    + "  flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px;"
    + "  background: #f4f6f8; font-size: 13px; line-height: 1.4;"
    + "}"
    + ".coe-msg { max-width: 85%; padding: 8px 10px; border-radius: 10px; white-space: pre-wrap; }"
    + ".coe-msg-user { align-self: flex-end; background: #0b4f6c; color: #fff; border-bottom-right-radius: 2px; }"
    + ".coe-msg-bot { align-self: flex-start; background: #fff; color: #222; border: 1px solid #e0e4e8; border-bottom-left-radius: 2px; }"
    + ".coe-msg-recommend { border-left: 4px solid #f4c542; }"
    + ".coe-msg-sources { font-size: 11px; color: #666; margin-top: 4px; }"
    + ".coe-toolbar {"
    + "  display: flex; gap: 6px; padding: 6px 8px; background: #fff;"
    + "  border-bottom: 1px solid #e0e4e8;"
    + "}"
    + ".coe-toolbar button, .coe-toolbar a {"
    + "  flex: 1; text-align: center; padding: 6px 4px; border-radius: 6px;"
    + "  border: 1px solid #d6dade; background: #f4f6f8; color: #1c2b33;"
    + "  text-decoration: none; cursor: pointer; font-size: 12px; line-height: 1.3;"
    + "}"
    + ".coe-toolbar button:hover, .coe-toolbar a:hover { background: #e6e9ec; }"
    + ".coe-toolbar button:disabled { opacity: .5; cursor: default; }"
    + ".coe-alert {"
    + "  border-radius: 10px; padding: 8px 10px; font-size: 13px; border-left: 4px solid #999;"
    + "  background: #fff;"
    + "}"
    + ".coe-alert-info { border-left-color: #4a90d9; }"
    + ".coe-alert-bajo { border-left-color: #f4c542; }"
    + ".coe-alert-medio { border-left-color: #f28c28; }"
    + ".coe-alert-alto { border-left-color: #e63946; background: #fff3f2; }"
    + ".coe-alert-title { font-weight: 700; margin-bottom: 2px; }"
    + ".coe-alert-time { font-size: 11px; color: #888; margin-top: 4px; }"
    + ".coe-input-row { display: flex; border-top: 1px solid #e0e4e8; padding: 8px; gap: 6px; background: #fff; }"
    + ".coe-input-row textarea {"
    + "  flex: 1; resize: none; border: 1px solid #d6dade; border-radius: 8px; padding: 8px; font-size: 13px;"
    + "  height: 38px; max-height: 90px;"
    + "}"
    + ".coe-input-row button {"
    + "  background: #0b4f6c; color: #fff; border: none; border-radius: 8px; padding: 0 14px; font-size: 13px;"
    + "  cursor: pointer;"
    + "}"
    + ".coe-input-row button:disabled { opacity: .5; cursor: default; }"
    + ".coe-toast {"
    + "  position: fixed; bottom: 90px; right: 20px; max-width: 300px; background: #fff; border-radius: 10px;"
    + "  box-shadow: 0 8px 24px rgba(0,0,0,.3); padding: 10px 12px; font-size: 13px; z-index: 2147483000;"
    + "  border-left: 4px solid #e63946; cursor: pointer; animation: coe-fade-in .25s ease-out;"
    + "}"
    + "@keyframes coe-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }"
    + ".coe-empty { color: #888; text-align: center; padding: 20px 8px; font-size: 13px; }"
    + ".coe-region-selector { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px; background: #fff; border: 1px solid #e0e4e8; border-radius: 10px; max-width: 96%; align-self: flex-start; }"
    + ".coe-region-btn { padding: 5px 10px; background: #f4f6f8; border: 1px solid #d6dade; border-radius: 6px; font-size: 12px; cursor: pointer; color: #1c2b33; }"
    + ".coe-region-btn:hover { background: #0b4f6c; color: #fff; border-color: #0b4f6c; }";

  // ----------------------------------------------------------
  // Construcción del DOM
  // ----------------------------------------------------------
  var host = document.createElement("div");
  host.id = "coe-asistente-widget";
  document.documentElement.appendChild(host);
  var shadow = host.attachShadow({ mode: "open" });

  var styleEl = document.createElement("style");
  styleEl.textContent = CSS;
  shadow.appendChild(styleEl);

  var fab = document.createElement("button");
  fab.className = "coe-fab";
  fab.setAttribute("aria-label", config.title);
  fab.innerHTML = '🆘<span class="coe-badge" style="display:none">0</span>';
  shadow.appendChild(fab);

  var panel = document.createElement("div");
  panel.className = "coe-panel";
  panel.innerHTML =
    '<div class="coe-header">' +
    "<span>" + escapeHtml(config.title) + "</span>" +
    '<div class="coe-header-actions">' +
    '<button class="coe-voice-btn" title="Activar/desactivar voz">🔊</button>' +
    '<button class="coe-notif-btn" title="Activar notificaciones">🔔</button>' +
    '<button class="coe-close-btn" title="Cerrar">✕</button>' +
    "</div>" +
    "</div>" +
    '<div class="coe-toolbar">' +
    '<button class="coe-reco-btn" title="Generar recomendaciones a partir de los documentos aprobados">💡 Ideas de mejora</button>' +
    '<a class="coe-biblioteca-link" target="_blank" rel="noopener" title="Ver documentos en los que se basa el asistente">📚 Biblioteca</a>' +
    '<button class="coe-region-select-btn" title="Cambiar país o región de consulta">🌎 País</button>' +
    "</div>" +
    '<div class="coe-feed"></div>' +
    '<div class="coe-input-row">' +
    '<textarea placeholder="Escribe tu pregunta..." rows="1"></textarea>' +
    "<button>Enviar</button>" +
    "</div>";
  shadow.appendChild(panel);

  var feed = panel.querySelector(".coe-feed");
  var textarea = panel.querySelector("textarea");
  var sendBtn = panel.querySelector(".coe-input-row button");
  var voiceBtn = panel.querySelector(".coe-voice-btn");
  var notifBtn = panel.querySelector(".coe-notif-btn");
  var closeBtn = panel.querySelector(".coe-close-btn");
  var recoBtn = panel.querySelector(".coe-reco-btn");
  var bibliotecaLink = panel.querySelector(".coe-biblioteca-link");
  var regionSelectBtn = panel.querySelector(".coe-region-select-btn");
  var badge = fab.querySelector(".coe-badge");

  (function setupBibliotecaLink() {
    try {
      var url = new URL("../biblioteca/index.html", scriptEl.src);
      if (config.country) url.searchParams.set("pais", config.country);
      bibliotecaLink.href = url.href;
    } catch (e) {
      bibliotecaLink.style.display = "none";
    }
  })();

  function updateVoiceBtn() {
    voiceBtn.textContent = isVoiceEnabled() ? "🔊" : "🔇";
  }
  updateVoiceBtn();

  function updateNotifBtn() {
    if (!("Notification" in window)) {
      notifBtn.style.display = "none";
      return;
    }
    notifBtn.textContent = Notification.permission === "granted" ? "🔔" : "🔕";
  }
  updateNotifBtn();

  var unreadCount = 0;
  function setUnread(n) {
    unreadCount = n;
    if (unreadCount > 0) {
      badge.style.display = "flex";
      badge.textContent = String(unreadCount);
    } else {
      badge.style.display = "none";
    }
  }

  function isOpen() {
    return panel.classList.contains("coe-open");
  }

  // ----------------------------------------------------------
  // Selección de país / región
  // ----------------------------------------------------------
  function hasRegionSelected() {
    // config.country set via data-country → always has a fixed country
    if (config.country) return true;
    // User previously chose (including "" = regional)
    return localStorage.getItem(STORAGE_REGION) !== null;
  }

  function getActiveCountry() {
    if (config.country) return config.country;
    var saved = localStorage.getItem(STORAGE_REGION);
    return (saved !== null && saved !== "") ? saved : undefined;
  }

  function selectRegion(country) {
    localStorage.setItem(STORAGE_REGION, country);
    // Remove any open selector
    var sel = feed.querySelector(".coe-region-selector");
    if (sel) sel.remove();
    var label = country || REGIONAL_LABEL;
    renderBotMessage(
      "Entendido. Consultaré información para " + label + ".\n¡Ahora puedes escribir tu pregunta!",
    );
    textarea.disabled = false;
    sendBtn.disabled = false;
    textarea.focus();
  }

  function renderRegionSelector() {
    // Remove any existing selector first
    var existing = feed.querySelector(".coe-region-selector");
    if (existing) existing.remove();

    var container = document.createElement("div");
    container.className = "coe-region-selector";

    // "Toda la región" option first
    var allBtn = document.createElement("button");
    allBtn.className = "coe-region-btn";
    allBtn.textContent = "🌎 " + REGIONAL_LABEL.split("(")[0].trim();
    allBtn.addEventListener("click", function () { selectRegion(""); });
    container.appendChild(allBtn);

    REGION_COUNTRIES.forEach(function (country) {
      var btn = document.createElement("button");
      btn.className = "coe-region-btn";
      btn.textContent = country;
      btn.addEventListener("click", function () { selectRegion(country); });
      container.appendChild(btn);
    });

    appendToFeed(container);
  }

  function showIntro() {
    renderBotMessage(
      "¡Hola! Soy el Asistente Virtual del COE (Centro de Operaciones de Emergencia) para " +
      "Centroamérica y República Dominicana.\n\n" +
      "Respondo preguntas sobre planes, protocolos y buenas prácticas de gestión de riesgos " +
      "y emergencias, a partir de los documentos oficiales aprobados en la biblioteca.\n\n" +
      "Mi base de conocimiento crece automáticamente cada vez que se aprueba un nuevo documento.\n\n" +
      "¿Sobre qué país deseas consultar, o prefieres a nivel de toda la región?",
    );
    renderRegionSelector();
    textarea.disabled = true;
    sendBtn.disabled = true;
  }

  function openPanel() {
    panel.classList.add("coe-open");
    setUnread(0);
    if (!hasRegionSelected() && !introShown) {
      showIntro();
      introShown = true;
    }
    feed.scrollTop = feed.scrollHeight;
  }

  function closePanel() {
    panel.classList.remove("coe-open");
  }

  fab.addEventListener("click", function () {
    if (isOpen()) closePanel();
    else openPanel();
  });
  closeBtn.addEventListener("click", closePanel);

  voiceBtn.addEventListener("click", function () {
    setVoiceEnabled(!isVoiceEnabled());
    updateVoiceBtn();
  });

  notifBtn.addEventListener("click", function () {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().then(updateNotifBtn);
    }
  });

  // ----------------------------------------------------------
  // Render de mensajes y alertas
  // ----------------------------------------------------------
  function appendToFeed(el) {
    var wasAtBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 30;
    feed.appendChild(el);
    if (wasAtBottom) feed.scrollTop = feed.scrollHeight;
  }

  function renderUserMessage(text) {
    var el = document.createElement("div");
    el.className = "coe-msg coe-msg-user";
    el.textContent = text;
    appendToFeed(el);
  }

  function renderBotMessage(text, sources, isRecommendation) {
    var el = document.createElement("div");
    el.className = "coe-msg coe-msg-bot";
    if (isRecommendation) el.classList.add("coe-msg-recommend");
    el.textContent = text;
    if (sources && sources.length) {
      var src = document.createElement("div");
      src.className = "coe-msg-sources";
      src.textContent = "Fuentes: " + sources.join(", ");
      el.appendChild(src);
    }
    appendToFeed(el);
    return el;
  }

  function formatTime(iso) {
    try {
      return new Date(iso).toLocaleString(config.lang, {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (e) {
      return iso;
    }
  }

  function renderAlert(alert) {
    var el = document.createElement("div");
    var severity = (alert.severity || "info").toLowerCase();
    el.className = "coe-alert coe-alert-" + severity;
    el.innerHTML =
      '<div class="coe-alert-title">⚠️ ' + escapeHtml(alert.title) + "</div>" +
      "<div>" + escapeHtml(alert.message) + "</div>" +
      '<div class="coe-alert-time">' + formatTime(alert.created_at) + "</div>";
    appendToFeed(el);
  }

  function showToast(alert) {
    var toast = document.createElement("div");
    toast.className = "coe-toast";
    toast.innerHTML =
      '<div class="coe-alert-title">⚠️ ' + escapeHtml(alert.title) + "</div>" +
      "<div>" + escapeHtml(alert.message) + "</div>";
    toast.addEventListener("click", function () {
      toast.remove();
      openPanel();
    });
    shadow.appendChild(toast);
    setTimeout(function () {
      toast.remove();
    }, 12000);
  }

  function speak(text) {
    if (!isVoiceEnabled()) return;
    if (!("speechSynthesis" in window)) return;
    try {
      var utter = new SpeechSynthesisUtterance(text);
      utter.lang = config.lang;
      var voices = window.speechSynthesis.getVoices();
      var esVoice = voices.find(function (v) {
        return v.lang && v.lang.toLowerCase().indexOf("es") === 0;
      });
      if (esVoice) utter.voice = esVoice;
      window.speechSynthesis.speak(utter);
    } catch (e) {
      console.warn("[Asistente] No se pudo usar la síntesis de voz:", e);
    }
  }

  function notifyAlert(alert) {
    showToast(alert);
    if (!isOpen()) setUnread(unreadCount + 1);
    speak(alert.title + ". " + alert.message);
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(alert.title, { body: alert.message });
      } catch (e) {
        // algunos navegadores requieren un Service Worker para notificaciones;
        // el toast visual y la voz siguen funcionando igual.
      }
    }
  }

  // ----------------------------------------------------------
  // Conexión con Supabase (REST simple, sin librerías)
  // ----------------------------------------------------------
  function supabaseHeaders() {
    return {
      apikey: config.anonKey,
      Authorization: "Bearer " + config.anonKey,
    };
  }

  function loadInitialAlerts() {
    var url = config.supabaseUrl + "/rest/v1/alerts?select=*&order=created_at.desc&limit=10";
    fetch(url, { headers: supabaseHeaders() })
      .then(function (res) {
        return res.ok ? res.json() : [];
      })
      .then(function (alerts) {
        if (!alerts || !alerts.length) {
          var empty = document.createElement("div");
          empty.className = "coe-empty";
          empty.textContent = "No hay alertas recientes. Escribe tu pregunta abajo.";
          feed.appendChild(empty);
        } else {
          alerts
            .slice()
            .reverse()
            .forEach(renderAlert);
        }

        var lastSeen = localStorage.getItem(STORAGE_LAST_ALERT);
        var newest = alerts && alerts.length ? alerts[0].created_at : null;

        if (newest && lastSeen && newest > lastSeen) {
          // Hubo una alerta nueva mientras el usuario no tenía la página abierta
          notifyAlert(alerts[0]);
        }
        if (newest) {
          localStorage.setItem(STORAGE_LAST_ALERT, newest);
        } else if (!lastSeen) {
          localStorage.setItem(STORAGE_LAST_ALERT, new Date(0).toISOString());
        }
      })
      .catch(function (err) {
        console.warn("[Asistente] No se pudieron cargar las alertas:", err);
      });
  }

  function pollAlerts() {
    var lastSeen = localStorage.getItem(STORAGE_LAST_ALERT) || new Date(0).toISOString();
    var url = config.supabaseUrl + "/rest/v1/alerts?select=*&order=created_at.asc&created_at=gt." +
      encodeURIComponent(lastSeen);
    fetch(url, { headers: supabaseHeaders() })
      .then(function (res) {
        return res.ok ? res.json() : [];
      })
      .then(function (alerts) {
        if (!alerts || !alerts.length) return;
        alerts.forEach(function (alert) {
          renderAlert(alert);
          notifyAlert(alert);
          localStorage.setItem(STORAGE_LAST_ALERT, alert.created_at);
        });
      })
      .catch(function (err) {
        console.warn("[Asistente] No se pudo revisar nuevas alertas:", err);
      });
  }

  // ----------------------------------------------------------
  // Chat
  // ----------------------------------------------------------
  function sendQuestion() {
    var question = textarea.value.trim();
    if (!question) return;

    renderUserMessage(question);
    textarea.value = "";
    sendBtn.disabled = true;

    var thinking = renderBotMessage("Pensando...");

    fetch(config.supabaseUrl + "/functions/v1/chat", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, supabaseHeaders()),
      body: JSON.stringify({
        site_key: config.siteKey,
        session_id: getSessionId(),
        question: question,
        country: getActiveCountry(),
      }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        thinking.remove();
        if (!result.ok) {
          renderBotMessage(
            "Lo siento, ocurrió un problema: " + (result.data.error || "error desconocido"),
          );
          return;
        }
        renderBotMessage(result.data.answer, result.data.sources);
      })
      .catch(function (err) {
        thinking.remove();
        renderBotMessage("No se pudo conectar con el asistente. Intenta de nuevo más tarde.");
        console.error("[Asistente] Error en el chat:", err);
      })
      .finally(function () {
        sendBtn.disabled = false;
      });
  }

  function sendRecommendations() {
    recoBtn.disabled = true;

    var activeCountry = getActiveCountry();
    renderUserMessage(
      "💡 Ideas de mejora" + (activeCountry ? " para " + activeCountry : " para la región"),
    );
    var thinking = renderBotMessage("Analizando los documentos aprobados...");

    fetch(config.supabaseUrl + "/functions/v1/chat", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, supabaseHeaders()),
      body: JSON.stringify({
        site_key: config.siteKey,
        session_id: getSessionId(),
        mode: "recommendations",
        country: getActiveCountry(),
      }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        thinking.remove();
        if (!result.ok) {
          renderBotMessage(
            "Lo siento, ocurrió un problema: " + (result.data.error || "error desconocido"),
          );
          return;
        }
        renderBotMessage("💡 " + result.data.answer, result.data.sources, true);
      })
      .catch(function (err) {
        thinking.remove();
        renderBotMessage("No se pudo conectar con el asistente. Intenta de nuevo más tarde.");
        console.error("[Asistente] Error en recomendaciones:", err);
      })
      .finally(function () {
        recoBtn.disabled = false;
      });
  }

  sendBtn.addEventListener("click", sendQuestion);
  textarea.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendQuestion();
    }
  });
  recoBtn.addEventListener("click", sendRecommendations);
  regionSelectBtn.addEventListener("click", function () {
    renderRegionSelector();
  });

  // ----------------------------------------------------------
  // Inicio
  // ----------------------------------------------------------
  if ("speechSynthesis" in window) {
    // Algunos navegadores cargan las voces de forma asíncrona
    window.speechSynthesis.getVoices();
  }

  loadInitialAlerts();
  setInterval(pollAlerts, config.pollMs);
})();
