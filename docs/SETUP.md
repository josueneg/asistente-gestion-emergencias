# Guía de instalación (paso a paso)

Esta guía te lleva desde cero hasta tener el asistente funcionando, usando
**solo cuentas gratuitas**. No necesitas saber programar: cuando aparece un
bloque de código, son comandos que copias y pegas en la Terminal, uno por
uno, presionando Enter después de cada uno.

Tiempo estimado: 45-60 minutos. Hazlo en orden, sin saltar pasos.

---

## Resumen de lo que vas a crear

| # | Cuenta gratuita | Para qué |
|---|---|---|
| 1 | GitHub | Guardar el código y ejecutar el monitoreo de clima 24/7 |
| 2 | Groq | El "cerebro" que responde el chat y redacta las alertas |
| 3 | Google AI Studio | Generar los embeddings (búsqueda inteligente en tus documentos) |
| 4 | Supabase | Base de datos, autenticación y funciones del servidor |
| 5 | Cloudflare | Publicar el widget y el panel de administración |

---

## 1. Subir el proyecto a GitHub

1. Crea una cuenta gratuita en [github.com](https://github.com) si no tienes una.
2. Crea un repositorio **nuevo y público** (por ejemplo, llamado `coe-panama-asistente`).
   No marques ninguna opción de "inicializar con README" (este proyecto ya tiene archivos).
3. En la Terminal, dentro de la carpeta `coe-panama-asistente`, ejecuta (reemplaza
   `TU-USUARIO` por tu usuario de GitHub):

   ```bash
   git add -A
   git commit -m "Version inicial del asistente COE"
   git remote add origin https://github.com/TU-USUARIO/coe-panama-asistente.git
   git push -u origin main
   ```

> El repositorio debe ser **público** para que el monitoreo de clima (GitHub Actions)
> se ejecute gratis de forma ilimitada.

---

## 2. Obtener tu clave de Groq (LLM gratuito)

1. Ve a [console.groq.com](https://console.groq.com) y crea una cuenta gratuita.
2. En el menú lateral, entra a **API Keys** → **Create API Key**.
3. Copia la clave (empieza con `gsk_...`). La llamaremos `GROQ_API_KEY`.
   Guárdala en un lugar seguro, no se vuelve a mostrar completa.

---

## 3. Obtener tu clave de Google AI Studio (embeddings)

1. Ve a [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
   e inicia sesión con una cuenta de Google.
2. Haz clic en **Create API key**.
3. Copia la clave. La llamaremos `GEMINI_API_KEY`.

---

## 4. Crear el proyecto de Supabase (base de datos + funciones)

### 4.1 Crear el proyecto

1. Ve a [supabase.com](https://supabase.com) y crea una cuenta gratuita.
2. **New project** → elige un nombre (ej. `coe-panama`), genera una contraseña de
   base de datos (guárdala) y elige la región más cercana a Panamá
   (por ejemplo, *East US*).
3. Espera 1-2 minutos a que el proyecto termine de crearse.

### 4.2 Copiar las credenciales

En el panel del proyecto, ve a **Settings → API** y copia:

- **Project URL** → la llamaremos `SUPABASE_URL`
- **anon public** key → la llamaremos `SUPABASE_ANON_KEY`
- **service_role** key → la llamaremos `SUPABASE_SERVICE_ROLE_KEY`
  (⚠️ esta clave es secreta, nunca la pongas en el widget ni la compartas)

### 4.3 Instalar la CLI de Supabase

En la Terminal (macOS, con [Homebrew](https://brew.sh) instalado):

```bash
brew install supabase/tap/supabase
supabase --version
```

### 4.4 Conectar tu proyecto local con Supabase

```bash
supabase login
```

Esto abre el navegador para autorizar. Luego, dentro de la carpeta del proyecto:

```bash
cd ~/coe-panama-asistente
supabase link --project-ref TU_PROJECT_REF
```

`TU_PROJECT_REF` es el identificador que aparece en tu `SUPABASE_URL`:
`https://TU_PROJECT_REF.supabase.co`.

### 4.5 Crear las tablas de la base de datos

```bash
supabase db push
```

Esto aplica `supabase/migrations/0001_init.sql`. Verifica en
**Table Editor** (en el panel de Supabase) que aparezcan las tablas:
`documents`, `doc_chunks`, `alerts`, `weather_config`, `sites`,
`rate_limit_counters`, `chat_logs`.

### 4.6 Configurar las claves secretas de las funciones

Elige también una frase secreta propia para `WEATHER_CRON_SECRET`
(cualquier texto largo y único, por ejemplo generado con `openssl rand -hex 16`).

```bash
supabase secrets set GROQ_API_KEY=tu_groq_api_key
supabase secrets set GEMINI_API_KEY=tu_gemini_api_key
supabase secrets set WEATHER_CRON_SECRET=tu_frase_secreta_unica
```

> `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` ya están
> disponibles automáticamente dentro de las Edge Functions; no es necesario
> configurarlas a mano.

### 4.7 Desplegar las funciones (Edge Functions)

```bash
supabase functions deploy ingest-document
supabase functions deploy chat
supabase functions deploy weather-alert
```

### 4.8 Crear tu usuario de administrador

1. En el panel de Supabase, ve a **Authentication → Users → Add user**.
2. Crea un usuario con tu correo y una contraseña (marca "Auto Confirm User").
3. Repite para cada persona del COE que vaya a usar el panel de administración.

---

## 5. Activar el monitoreo de clima 24/7 (GitHub Actions)

1. En tu repositorio de GitHub, ve a **Settings → Secrets and variables → Actions**.
2. Crea estos tres "New repository secret":

   | Nombre | Valor |
   |---|---|
   | `SUPABASE_URL` | el mismo `SUPABASE_URL` del paso 4.2 |
   | `SUPABASE_ANON_KEY` | el mismo `SUPABASE_ANON_KEY` del paso 4.2 |
   | `WEATHER_CRON_SECRET` | la misma frase secreta del paso 4.6 |

3. Ve a la pestaña **Actions** del repositorio. Si GitHub pide habilitar los workflows,
   acéptalo.
4. Busca el workflow **"Monitoreo de clima COE"** y haz clic en **Run workflow** para
   probarlo manualmente. Revisa los logs: deberías ver algo como
   `Revisando 1 ubicación(es)...`.

A partir de aquí, el workflow se ejecuta solo cada 15 minutos.

---

## 6. Publicar el widget y el panel de administración (Cloudflare Pages)

1. Ve a [dash.cloudflare.com](https://dash.cloudflare.com) y crea una cuenta gratuita.
2. Entra a **Workers & Pages → Create → Pages → Connect to Git**.
3. Selecciona tu repositorio `coe-panama-asistente`.
4. En "Build settings":
   - **Framework preset**: None
   - **Build command**: (déjalo vacío)
   - **Build output directory**: `/` (la raíz del repositorio)
5. Haz clic en **Save and Deploy**. Cloudflare te dará una URL como
   `https://coe-panama-asistente.pages.dev`.

Con esta configuración, tus páginas quedan disponibles en:

- Widget: `https://coe-panama-asistente.pages.dev/widget/widget.js`
- Demo del widget: `https://coe-panama-asistente.pages.dev/widget/`
- Panel admin: `https://coe-panama-asistente.pages.dev/admin/`

---

## 7. Primer uso del panel de administración

1. Abre `https://TU-PROYECTO.pages.dev/admin/` en el navegador.
2. **Configuración inicial**: pega tu `SUPABASE_URL` y `SUPABASE_ANON_KEY` (paso 4.2).
3. **Iniciar sesión**: usa el correo/contraseña que creaste en el paso 4.8.
4. Ve a la pestaña **Sitios / Embed**:
   - En "URL pública de widget.js" pega
     `https://TU-PROYECTO.pages.dev/widget/widget.js` y guarda.
   - En "Crear nuevo sitio" escribe un nombre (ej. "Sitio de pruebas") y crea.
   - Copia el `<script>` generado.
5. Ve a la pestaña **Documentos** y sube un PDF/Word/Excel de prueba (un manual
   o plan de emergencia corto). Espera a que el estado cambie a `indexed`.
6. Ve a la pestaña **Clima** y revisa/ajusta la ubicación y los umbrales
   (ya viene una fila para Ciudad de Panamá).

---

## 8. Insertar el widget en tu sitio

Pega el `<script>` que copiaste en el paso 7, justo antes de `</body>`,
en cualquier página HTML de cualquier sitio web:

```html
<script
  src="https://TU-PROYECTO.pages.dev/widget/widget.js"
  data-supabase-url="https://TU-PROYECTO.supabase.co"
  data-supabase-anon-key="TU_ANON_KEY"
  data-site-key="TU_SITE_KEY"
></script>
```

Recarga la página: debe aparecer un botón flotante 🆘 en la esquina inferior derecha.

---

## 9. Verificación final

- [ ] Abres el widget y al hacer una pregunta sobre el documento que subiste,
      el asistente responde citando ese documento.
- [ ] En la pestaña **Clima** del panel admin, bajas temporalmente un umbral
      (ej. lluvia a `0.1`), ejecutas manualmente el workflow de GitHub Actions
      ("Run workflow") y, tras un minuto, aparece una nueva fila en
      **Alertas** y el widget muestra el aviso (toast) + lo lee en voz alta.
      Después, vuelve a subir el umbral a un valor realista (ej. 10).
- [ ] Abres `widget/index.html` desde otro origen (otro puerto o archivo)
      y el widget funciona igual (confirma que no hay problemas de CORS).

---

## Solución de problemas comunes

- **El widget no aparece**: revisa la consola del navegador (F12). Si dice
  "Faltan atributos data-...", revisa el `<script>` insertado.
- **"site_key inválida"**: verifica que copiaste el `site_key` completo desde
  la pestaña Sitios del panel admin.
- **Error 401/403 al subir documentos**: tu sesión expiró, vuelve a iniciar
  sesión en el panel admin.
- **No se pudo extraer texto del PDF**: algunos PDF son imágenes escaneadas
  (sin texto seleccionable). Usa la opción "Agregar texto o contenido de una
  página web" y pega el texto manualmente.
- **El workflow de clima no corre solo**: GitHub desactiva los workflows
  programados si el repositorio está inactivo 60 días. Si pasa, entra a
  Actions y vuelve a habilitarlo (o ejecútalo manualmente una vez).
- **El proyecto de Supabase aparece "Paused"**: los proyectos gratuitos se
  pausan tras 7 días sin actividad. El cron de clima escribe en la base cada
  15 minutos y evita esto; si ocurre igual, entra al dashboard y pulsa
  "Restore project".
