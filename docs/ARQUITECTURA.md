# Arquitectura del sistema

Este documento explica **cómo está construido** el asistente y **por qué** se
tomó cada decisión. Está dirigido a quien vaya a darle mantenimiento técnico
en el futuro (no es necesario para usar el sistema día a día — para eso ver
[MANUAL_USUARIO.md](MANUAL_USUARIO.md)).

## Visión general

```
┌─────────────────┐        ┌──────────────────────────────────────────┐
│  Cualquier sitio │        │              Supabase (free)              │
│  web (widget)    │        │                                            │
│                  │  HTTP  │  ┌────────────┐   ┌─────────────────────┐ │
│  widget.js  ─────┼───────▶│  │ Edge        │   │ Postgres + pgvector │ │
│  (Shadow DOM)    │        │  │ Functions   │──▶│  - documents        │ │
│                  │◀───────┼──│  - chat     │   │  - doc_chunks       │ │
└─────────▲────────┘ poll   │  │  - ingest-  │   │  - alerts           │ │
          │ PostgREST       │  │    document │   │  - weather_config   │ │
          │ (anon key)      │  │  - weather- │   │  - sites            │ │
          │                 │  │    alert    │   │  - chat_logs        │ │
┌─────────┴────────┐        │  └─────┬──────┘   └─────────────────────┘ │
│ Panel admin       │        │        │                                  │
│ (Cloudflare Pages)│───────▶│        │  Auth (email/password)           │
│ - login           │        └────────┼──────────────────────────────────┘
│ - subir docs      │                 │
│ - config clima    │                 ▼
└───────────────────┘        ┌─────────────┐   ┌──────────────┐
                              │   Groq API   │   │  Gemini API  │
                              │ (LLM chat /  │   │ (embeddings) │
                              │  alertas)    │   │              │
                              └─────────────┘   └──────────────┘

┌──────────────────────────┐
│ GitHub Actions (cron)     │
│ cada 15 min               │
│ weather-check.mjs ────────┼──▶ Open-Meteo (multi-modelo)
│         │                 │
│         └─────────────────┼──▶ Edge Function weather-alert
└──────────────────────────┘
```

## Componentes y justificación

### 1. Supabase (Postgres + pgvector + Edge Functions + Auth)

Es el "backend" completo del proyecto. Se eligió porque combina, en un solo
servicio gratuito:

- **Base de datos relacional** (Postgres) para todas las tablas.
- **`pgvector`**, una extensión que permite guardar "embeddings" (vectores
  numéricos que representan el significado de un texto) y buscar por
  similitud — esto es lo que hace posible el RAG (ver más abajo).
- **Edge Functions**: funciones de servidor (escritas en TypeScript/Deno) que
  exponen endpoints HTTP. Aquí vive toda la lógica que no debe correr en el
  navegador (porque usa claves secretas como `GROQ_API_KEY`).
- **Auth**: login con correo/contraseña para el panel de administración, sin
  tener que construir un sistema de usuarios propio.
- **Row Level Security (RLS)**: reglas a nivel de base de datos que controlan
  qué puede leer/escribir cada tipo de usuario (autenticado vs. público).
  Es la razón por la que la `anon key` (pública) puede usarse de forma segura
  en el widget: aunque cualquiera la vea, solo puede hacer lo que las
  políticas RLS permiten (ej. leer `alerts`, pero no modificar `documents`).

### 2. RAG (Retrieval-Augmented Generation) sobre documentos

**Problema que resuelve**: un LLM genérico no conoce los manuales y planes de
emergencia específicos del COE. RAG le "presta" ese conocimiento en el
momento de responder, sin tener que re-entrenar ningún modelo.

**Cómo funciona**:

1. **Ingesta** (`ingest-document`): cuando se sube un documento, su texto se
   divide en fragmentos ("chunks") de ~1500 caracteres con superposición
   (para no cortar ideas a la mitad). Cada fragmento se convierte en un
   vector de 768 números (embedding) usando Gemini, y se guarda en
   `doc_chunks` junto con el texto original.

2. **Consulta** (`chat`): cuando alguien hace una pregunta, esa pregunta
   también se convierte en un embedding. Postgres compara ese vector contra
   todos los de `doc_chunks` usando la operación `<=>` (distancia de coseno,
   acelerada por un índice **HNSW**) y devuelve los 5 fragmentos más
   parecidos — `match_doc_chunks()` en la migración. Solo se buscan fragmentos
   de documentos **aprobados** (`approval_status='approved'`, ver sección 7) y,
   si se indica un país, se priorizan los documentos aplicables a ese país más
   los "generales" (sin país específico).

3. Esos fragmentos se insertan como "contexto" en el prompt que se envía a
   Groq, junto con instrucciones de responder como asistente del COE. El
   modelo responde basándose en ese contexto, y la función devuelve también
   las fuentes (`sources`) para que el widget las muestre.

**Por qué Gemini para embeddings y Groq para el chat**: son dos servicios
gratuitos distintos, cada uno con su propio límite gratuito. Usar Gemini solo
para embeddings (que ocurren rara vez — solo al subir documentos) y Groq solo
para generar texto (que ocurre en cada pregunta) reparte la carga entre ambas
cuotas gratuitas y evita agotar una sola.

**Por qué el parseo de PDF/Word/Excel ocurre en el navegador**: las Edge
Functions de Supabase corren sobre Deno, que tiene soporte limitado para
librerías binarias de Node como `pdf-parse`. En cambio, existen versiones de
`pdf.js`, `mammoth` y `SheetJS` empaquetadas para navegador, disponibles desde
un CDN (`esm.sh`) sin instalar nada. El panel admin extrae el texto
localmente y envía **solo texto plano** a la función `ingest-document`, lo
que además reduce el tamaño de las solicitudes.

### 3. Monitoreo de clima multi-modelo

**Problema que resuelve**: un solo modelo meteorológico puede equivocarse o
dar una lectura aislada. Comparar varios modelos da una visión más confiable
("consenso") antes de generar una alerta.

**Cómo funciona**:

1. **GitHub Actions** ejecuta `scripts/weather-check.mjs` cada 15 minutos
   (cron `*/15 * * * *`). Se eligió GitHub Actions porque, en un repositorio
   **público**, los minutos de ejecución son ilimitados — esto da monitoreo
   24/7 sin ningún servidor propio.

2. El script lee las ubicaciones activas de la tabla `weather_config` (vía
   PostgREST, con la `anon key`) y pide a **Open-Meteo** el pronóstico de las
   próximas 6 horas para 4 modelos a la vez (`ecmwf_ifs025`, `gfs_seamless`,
   `icon_seamless`, `gem_seamless`) en una sola llamada HTTP. Open-Meteo se
   eligió porque es gratis, no requiere API key y soporta esta consulta
   multi-modelo de forma nativa.

3. Para cada modelo calcula el máximo de lluvia, viento y rachas esperadas.
   Si **algún modelo** supera los umbrales configurados (`rain_threshold_mm_h`,
   `wind_threshold_kmh`), se envían los resúmenes de **todos** los modelos a
   la función `weather-alert`.

4. `weather-alert` le pide a Groq (en modo JSON, temperatura baja para
   respuestas consistentes) que **evalúe el consenso entre modelos** y decida
   si amerita una alerta, con qué severidad (`bajo`/`medio`/`alto`) y un
   mensaje en español con recomendaciones. Si decide que sí, se inserta una
   fila en `alerts`.

**Por qué la decisión final la toma un LLM y no una regla fija**: permite que
la alerta tenga en cuenta el contexto (ej. "3 de 4 modelos coinciden en lluvia
intensa" pesa más que "1 modelo aislado marca un pico"), y que el mensaje sea
legible y con recomendaciones, no solo un número.

### 4. Widget embebible

**Problema que resuelve**: el COE necesita poder poner el asistente en
*cualquier* sitio web (el propio, el de otra institución, una intranet) con
el mínimo esfuerzo y sin afectar el diseño de esas páginas.

**Decisiones de diseño**:

- **Un solo archivo `widget.js`, cero dependencias**: se inserta con una sola
  etiqueta `<script>`. No requiere build, npm, ni frameworks.
- **Shadow DOM**: todo el HTML/CSS del widget vive dentro de un
  `attachShadow({mode:"open"})`. Esto aísla sus estilos del sitio anfitrión
  (no hereda ni contamina CSS) — crítico para "cualquier sitio web".
- **Configuración vía atributos `data-*`**: cada sitio define su propia
  `data-supabase-url`, `data-supabase-anon-key` y `data-site-key` (y
  opcionalmente idioma, título, frecuencia de sondeo).
- **"Tiempo real" por sondeo (polling)**: el widget consulta periódicamente
  (`pollMs`, por defecto 60s) la tabla `alerts` vía PostgREST con la
  `anon key`, comparando contra el `created_at` de la última alerta vista
  (guardado en `localStorage`). Es más simple y robusto entre distintos
  orígenes que una suscripción Realtime por WebSocket, al costo de hasta 60s
  de retraso — aceptable para alertas de clima.
- **Notificaciones duales**: cada alerta nueva dispara (a) un *toast* visual
  con color según severidad, (b) una notificación del sistema vía
  `Notification` API (si el usuario dio permiso), y (c) lectura en voz alta
  con `speechSynthesis` en español (`lang='es-ES'`), con un botón para
  silenciar.

### 5. Seguridad del endpoint público (`chat`)

Como `chat` debe ser invocable desde cualquier sitio (incluye la `anon key` en
el HTML público), se añadieron dos controles mínimos para evitar abuso que
agote las cuotas gratuitas de Groq/Gemini:

- **`site_key`** (tabla `sites`): cada sitio que use el widget tiene una
  clave propia generada por el panel admin. `chat` rechaza (403) cualquier
  solicitud con una clave no registrada.
- **Límite de solicitudes por hora** (tabla `rate_limit_counters`): se
  cuentan las solicitudes por `site_id` en ventanas de una hora; al superar
  `RATE_LIMIT_PER_HOUR` (60) se responde 429.

Esto no sustituye autenticación de usuario final (el chat es público por
diseño), pero limita el daño de un uso indebido o un bucle accidental.

### 6. Panel de administración

Página estática (sin build) servida junto al widget en Cloudflare Pages.
Usa Supabase Auth para que solo personal autorizado del COE pueda:

- Subir/eliminar documentos (con país de procedencia/aplicable y descripción
  opcionales) y ver su estado de indexado.
- Revisar la **bandeja de entrada** de documentos enviados por el público y
  aprobarlos o rechazarlos (ver sección 7).
- Configurar ubicaciones y umbrales de clima.
- Ver el historial de alertas generadas.
- Crear "sitios" (cada sitio = un `site_key`, opcionalmente con un país por
  defecto) y copiar el snippet de embed listo para pegar, incluyendo la URL
  pública de `widget.js`.

### 7. Biblioteca pública de documentos (revisión manual + recomendaciones por país)

**Problema que resuelve**: una sola persona del COE no puede digitalizar todos
los planes, manuales y protocolos de gestión de emergencias de un país. Esta
fase permite que **cualquier persona** proponga documentos, pero **solo el
COE decide** cuáles entran a la base de conocimiento del asistente — y deja
público, de forma transparente, en qué se basa.

```text
[enviar/] --(submit-document)--> documents (approval_status='pending')
                                          │
                                          │ Panel admin → "Bandeja de entrada"
                                          ▼
                 aprobar (approve-document)        rechazar (reject-document)
                          │                                  │
                          ▼                                  ▼
        doc_chunks (indexado) +                    se borra de "documents"
        approval_status='approved'                 (cascada: doc_chunks,
                          │                          document_submissions)
                          ▼                                  │
              aparece en [biblioteca/]                       ▼
              y se usa en "chat" (RAG)              correo "rechazado"
                          │                          (si dejó email)
                          ▼
              correo "aprobado"
              (si dejó email)
```

- **`submit-document`** (pública, sin autenticación): recibe el texto ya
  extraído en el navegador (igual que el panel admin), un país de procedencia
  (obligatorio) y un país al que aplica (opcional — vacío = "general, aplica
  a todos los países"), descripción y datos de contacto opcionales. Aplica un
  límite de 5 envíos/hora por IP (tabla `submission_rate_limits`) para evitar
  abuso. Guarda el documento con `approval_status='pending'` y, si hay
  nombre/correo, una fila en `document_submissions` — tabla separada de
  `documents` para no exponer datos de contacto en la biblioteca pública.

- **Bandeja de entrada** (panel admin, pestaña nueva): lista los documentos
  con `approval_status='pending'`, con vista previa del texto extraído y los
  datos de quien lo envió (si los dio).

- **`approve-document`** (requiere sesión admin): indexa el documento (mismo
  pipeline de chunking + embeddings que `ingest-document`, factorizado en
  `_shared/index-document.ts`), lo marca `approval_status='approved'` y envía
  un correo de confirmación a quien lo envió (si dejó correo).

- **`reject-document`** (requiere sesión admin): elimina el documento por
  completo (cascada a `doc_chunks` y `document_submissions`) y envía un
  correo de rechazo, con motivo opcional, a quien lo envió.

- **RLS de transparencia**: una política nueva permite **lectura pública** de
  `documents` cuando `approval_status='approved'`. Esto alimenta la página
  [biblioteca/](../biblioteca/index.html) directamente vía PostgREST, sin
  necesitar ninguna Edge Function adicional.

- **Clasificación por país**: `country_origin` (de dónde viene el documento) y
  `country_applicable` (a qué país aplica; `NULL` = general). `match_doc_chunks`
  exige `approval_status='approved'` y, si se pasa un `country_filter`, incluye
  los fragmentos de documentos de ese país **más** los documentos generales
  (`country_applicable IS NULL`).

- **Recomendaciones por país** (`chat` con `mode='recommendations'`): en vez
  de responder una pregunta puntual, busca ~12 fragmentos relevantes (usando
  una consulta fija sobre "riesgos, vacíos y oportunidades de mejora", o el
  tema que indique la persona) y le pide a Groq un rol de "analista de
  riesgos" que proponga 3-6 mejoras concretas y priorizadas, citando el
  documento del que sale cada una y señalando vacíos de información si los
  fragmentos no alcanzan.

- **Notificaciones por correo (Brevo)**: `_shared/email.ts` envía los correos
  de aprobado/rechazado vía la API de Brevo (`BREVO_API_KEY`,
  `NOTIFICATIONS_FROM_EMAIL`). Si esas variables no están configuradas, la
  función simplemente no envía nada — el flujo de aprobación/rechazo sigue
  funcionando igual.

- **`sites.country`**: cada sitio puede tener un país por defecto, que el
  panel admin incluye como `data-country` en el snippet del widget — así el
  widget de cada sitio queda enfocado en su país sin que cada visitante tenga
  que indicarlo.

## Resumen de costos (free tier, 2026)

| Servicio | Límite gratuito relevante | Uso esperado del COE |
|---|---|---|
| Supabase | 500 MB DB, 2 proyectos, Edge Functions incluidas | Muy por debajo si los documentos son manuales/PDF típicos |
| Groq | ~30 solicitudes/min (Llama 3.3 70B) | Cron de clima: 1 cada 15 min. Chat: depende del uso del widget, limitado por `rate_limit_counters` |
| Google AI Studio (Gemini) | Cuota diaria de embeddings | Solo se usa al subir/aprobar documentos y al hacer preguntas (1 embedding por pregunta) |
| GitHub Actions | Ilimitado en repos públicos | 1 ejecución corta cada 15 min |
| Cloudflare Pages | Hosting estático ilimitado | Widget + panel admin + páginas públicas son archivos estáticos |
| Open-Meteo | Gratis, sin key | 1 llamada multi-modelo cada 15 min por ubicación |
| Brevo | 300 correos/día gratis | 1 correo por aprobación/rechazo de documento enviado con email de contacto |

## Próximos pasos (Fase 2)

El monitoreo de noticias/redes sociales vía RSS está diseñado pero no
implementado — ver [FASE2-RSS.md](FASE2-RSS.md). Reutilizará la misma tabla
`alerts` y el mismo widget, por lo que no requiere cambios en lo ya
construido.
