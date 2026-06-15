# Manual de uso — Asistente de Gestión de Emergencias

Este manual está dirigido al personal del Centro de Operaciones de Emergencia
(COE) que usará el asistente día a día: tanto quienes **consultan** el
asistente (chat público) como quienes **administran** sus documentos y
configuración (panel de administración).

> Si el sistema todavía no está instalado, primero sigue
> [SETUP.md](SETUP.md). Este manual asume que ya está funcionando y que
> tienes la dirección (URL) del panel de administración y del widget.

---

## 1. ¿Qué hace el asistente?

El asistente tiene dos funciones principales:

1. **Responder preguntas** sobre los manuales, planes de emergencia y
   procedimientos que el COE haya cargado (PDF, Word, Excel o texto). Las
   respuestas indican de qué documento salió la información.
2. **Avisar automáticamente** cuando el pronóstico del clima en las
   ubicaciones configuradas (lluvia o viento) supera los niveles definidos,
   comparando varios modelos meteorológicos. El aviso aparece de forma
   **visual** (ventana emergente / "toast") y se **lee en voz alta**.

---

## 2. Usar el chat (widget)

El widget aparece como un botón flotante 🆘 en la esquina inferior derecha de
cualquier página donde se haya insertado.

### 2.1 Hacer una pregunta

1. Haz clic en el botón 🆘 para abrir el panel del asistente.
2. Escribe tu pregunta en el cuadro de texto, por ejemplo:
   - "¿Cuál es el protocolo si se reporta un colapso de techo?"
   - "¿A quién debo notificar en caso de inundación en Colón?"
   - "Resume el procedimiento de evacuación del plan de emergencia."
3. Presiona Enter o el botón de enviar.
4. El asistente responderá con una recomendación y, si la información viene
   de un documento cargado, mostrará debajo el nombre del documento de donde
   la tomó ("Fuentes").

> Si el asistente no encuentra información en los documentos cargados,
> responderá con buenas prácticas generales y lo indicará — siempre conviene
> verificar contra el procedimiento oficial.

### 2.2 Pedir ideas de mejora (💡) y ver la biblioteca (📚)

En la parte superior del panel del asistente, debajo del título, hay una
barra con dos botones:

- **💡 Ideas de mejora**: en vez de responder una pregunta puntual, el
  asistente analiza los documentos aprobados (priorizando los del país
  configurado para ese sitio, si lo hay) y propone una lista de 3 a 6 mejoras
  concretas y priorizadas — por ejemplo, vacíos en los protocolos, riesgos no
  cubiertos o acciones recomendadas — citando de qué documento sale cada una.
  Esta respuesta aparece resaltada con un borde amarillo para diferenciarla
  de las respuestas normales del chat.
- **📚 Biblioteca**: abre en una pestaña nueva la página pública de
  Biblioteca, donde se puede ver el listado completo de documentos que el
  asistente está usando actualmente para responder y dar recomendaciones (ver
  sección 3.2).

> Estos dos botones usan la misma información que el chat: solo se basan en
> documentos que ya fueron revisados y aprobados (sección 4.3).

### 2.3 Alertas de clima

Cuando el sistema genera una alerta nueva, automáticamente:

- Aparece una **ventana emergente (toast)** con un color según la gravedad:
  - 🟦 Informativo
  - 🟨 Bajo
  - 🟧 Medio
  - 🟥 Alto
- Si diste permiso de notificaciones del navegador, también aparece una
  **notificación del sistema** (fuera de la pestaña).
- El mensaje se **lee en voz alta** en español.

El historial de alertas recientes también aparece dentro del panel del
asistente, debajo del chat.

### 2.4 Activar/desactivar sonido y notificaciones

En la parte superior del panel del asistente hay dos botones:

- 🔊 / 🔇 — activa o desactiva la lectura en voz alta de las alertas.
- 🔔 / 🔕 — solicita o indica el estado del permiso de notificaciones del
  navegador. La primera vez, el navegador preguntará si autorizas las
  notificaciones; acepta para recibirlas incluso si la pestaña no está activa.

Estas preferencias se guardan en el navegador, por lo que cada persona/equipo
las configura una sola vez por dispositivo.

---

## 3. Páginas públicas: enviar un documento y ver la biblioteca

Además del chat, el sistema tiene dos páginas web públicas — no requieren
cuenta ni iniciar sesión — donde **cualquier persona** puede colaborar con la
base de conocimiento del asistente y ver en qué se basa.

### 3.1 Enviar un documento

En la página **Enviar un documento** (enlace desde la página principal o
desde el botón 📚 del widget), cualquier persona puede proponer un manual,
plan, protocolo o guía de gestión de emergencias:

1. Selecciona el archivo (PDF, Word o Excel). El navegador extrae el texto
   automáticamente.
2. Indica el **país de procedencia** del documento (obligatorio).
3. Indica el **país al que aplica** (opcional) — si el documento sirve para
   varios países o no es específico de uno, se deja en "General / aplica a
   todos los países".
4. Escribe una breve descripción de qué es el documento.
5. Opcionalmente, indica un nombre y un correo de contacto, para recibir un
   aviso por email cuando el documento sea revisado.
6. Haz clic en enviar.

El documento queda **pendiente de revisión** — todavía no es usado por el
asistente. El equipo del COE lo revisará en algún momento (puede ser minutos,
días o semanas) y decidirá si lo aprueba o lo rechaza (sección 4.3). Si se
dejó un correo, se envía un aviso automático cuando eso ocurre.

> Para evitar abuso, el sistema limita la cantidad de documentos que se
> pueden enviar desde la misma conexión a internet en una hora.

### 3.2 Biblioteca

En la página **Biblioteca**, cualquier persona puede ver el listado completo
de documentos que el asistente **ya tiene aprobados** y está usando para
responder preguntas y generar recomendaciones. Por cada documento se muestra:

- Nombre del archivo y descripción.
- País de procedencia.
- País al que aplica (o "General" si aplica a todos).
- Fecha en que fue aprobado.

Se puede filtrar por país usando el selector en la parte superior. Esta
página es la forma de mostrar **transparencia**: cualquiera puede verificar
en qué información se basa el asistente, sin necesidad de acceder al panel de
administración.

---

## 4. Panel de administración

El panel de administración es para el personal encargado de mantener
actualizados los documentos y la configuración de clima. Requiere una cuenta
(correo y contraseña) creada previamente por quien instaló el sistema (ver
[SETUP.md](SETUP.md), sección 4.8).

### 4.1 Acceder

1. Abre la URL del panel admin (ej. `https://tu-proyecto.pages.dev/admin/`).
2. La primera vez, ingresa la **URL de Supabase** y la **clave anon** (te las
   debe entregar quien instaló el sistema). Solo se hace una vez por
   navegador.
3. Inicia sesión con tu correo y contraseña.

### 4.2 Pestaña "Documentos"

Aquí se cargan los manuales, planes de emergencia y demás documentos que el
asistente usará para responder.

**Clasificación (aplica a la próxima subida)**:

Antes de subir un archivo o agregar texto, puedes elegir en la tarjeta
"Clasificación":

- **País de procedencia**: de dónde viene el documento.
- **País al que aplica**: a qué país aplican sus recomendaciones (déjalo en
  "No especificado" / "General" si aplica a todos los países).
- **Descripción**: una frase breve sobre el contenido del documento.

Estos datos quedan asociados al documento y son los que se muestran en la
**Biblioteca** pública (sección 3.2).

> A diferencia de los documentos enviados por el público desde
> **Enviar un documento**, los que subes aquí quedan **aprobados
> automáticamente** — no pasan por la Bandeja de entrada.

**Subir un archivo (PDF, Word o Excel)**:

1. Haz clic en el selector de archivo y elige el documento.
2. El sistema lo procesa en tu navegador (extrae el texto) y luego lo envía
   a indexar. Verás mensajes de progreso ("Procesando...", "Generando
   embeddings e indexando...", "Listo: ... agregado (N fragmentos)").
3. El documento aparece en la tabla con estado:
   - 🟢 **indexed**: listo, el asistente ya puede usarlo.
   - ⚪ **pending**: procesándose.
   - 🔴 **error**: algo falló (revisa el mensaje de error mostrado). Causas
     comunes: el PDF es una imagen escaneada sin texto seleccionable.

**Agregar texto o contenido de una página web**:

Si tienes información en un sitio web (sin archivo descargable) o notas que
quieras que el asistente conozca:

1. Copia el texto relevante de la página o documento.
2. En "Agregar texto o contenido de una página web", escribe un título
   descriptivo (ej. "Procedimiento SINAPROC - sitio web") y pega el texto.
3. Haz clic en "Agregar al asistente".

**Eliminar un documento**:

En la tabla de documentos indexados, haz clic en "Eliminar" junto al
documento. Esto elimina también todos sus fragmentos indexados — el
asistente dejará de usar esa información.

> **Recomendación**: cuando un manual o plan se actualice, sube la nueva
> versión con un nombre claro (ej. incluye la fecha) y elimina la versión
> anterior, para que el asistente no mezcle información desactualizada con la
> vigente.

En la tabla, además del estado de indexado, aparece una columna **País**
(país de procedencia → país al que aplica) y una columna **Aprobación**
(aprobado/pendiente).

### 4.3 Pestaña "Bandeja de entrada"

Aquí aparecen los documentos que **cualquier persona** envió desde la página
pública **Enviar un documento** (sección 3.1) y que todavía no han sido
revisados.

Por cada documento se muestra:

- Nombre del archivo, país de procedencia, país al que aplica y descripción.
- Nombre y correo de quien lo envió (si los dejó).
- Una vista previa del texto extraído (haz clic para expandirla).
- Dos botones: **✅ Aprobar** y **❌ Rechazar**.

**Aprobar un documento**:

Al hacer clic en "✅ Aprobar", el sistema procesa el documento (lo divide en
fragmentos y genera los embeddings, igual que en la pestaña Documentos), lo
marca como aprobado y lo agrega a la **Biblioteca** pública — a partir de ese
momento el asistente puede usarlo para responder y dar recomendaciones. Si
quien lo envió dejó un correo, recibe un aviso automático de que su documento
fue aceptado.

**Rechazar un documento**:

Al hacer clic en "❌ Rechazar", el sistema pide confirmación y permite
escribir un motivo opcional (por ejemplo, "documento duplicado" o "no es
información de gestión de emergencias"). Al confirmar, el documento se
**elimina por completo** — no queda en ningún listado. Si quien lo envió dejó
un correo, recibe un aviso automático de que su documento no fue aceptado
(incluyendo el motivo, si se escribió uno).

> No hay un plazo fijo para revisar la Bandeja de entrada: puede ser en
> minutos, días o semanas. Mientras un documento esté pendiente, **no** es
> usado por el asistente ni aparece en la Biblioteca pública.

### 4.4 Pestaña "Clima"

Aquí se configuran las ubicaciones y los umbrales que activan una alerta de
clima.

**Tabla de ubicaciones monitoreadas**:

Cada fila representa un punto geográfico (ej. "Ciudad de Panamá", "Colón").
Para cada uno se puede editar:

- **Lat / Lon**: coordenadas geográficas (decimales).
- **Umbral lluvia (mm/h)**: si el pronóstico de algún modelo meteorológico
  supera este valor, se evalúa una alerta.
- **Umbral viento (km/h)**: igual, para velocidad de viento.
- **Activo**: si está desmarcado, esa ubicación no se monitorea.

Después de cambiar cualquier valor, haz clic en "Guardar" en esa fila.
"Eliminar" quita la ubicación del monitoreo.

**Agregar una nueva ubicación**:

Completa el formulario "Agregar ubicación" con nombre, coordenadas y
umbrales, y haz clic en "Agregar". Para obtener las coordenadas de un lugar,
puedes buscarlo en cualquier mapa (ej. Google Maps: clic derecho sobre el
punto → copiar coordenadas).

> **Sobre los umbrales**: valores más bajos generan alertas con más
> frecuencia (más sensibles); valores más altos solo avisan ante eventos
> severos. Se recomienda ajustar gradualmente según la experiencia local
> (ej. empezar con lluvia 10 mm/h y viento 50 km/h, y afinar con el tiempo).

### 4.5 Pestaña "Alertas"

Muestra el historial de todas las alertas generadas automáticamente (fecha,
tipo, severidad, título y mensaje completo). Es de solo lectura — sirve para
revisar qué avisos se han emitido y cuándo, por ejemplo para un reporte
posterior a un evento.

### 4.6 Pestaña "Sitios / Embed"

Aquí se gestiona en qué páginas web aparece el widget del asistente.

**URL pública de widget.js**: dirección donde quedó publicado el archivo
`widget.js` (la define quien instaló el sistema, ver SETUP.md). Se usa para
generar automáticamente el código de inserción.

**Crear un nuevo sitio**:

1. Escribe un nombre descriptivo (ej. "Sitio web institucional del COE").
2. En "Origen permitido" puedes dejar `*` (cualquier sitio) o indicar un
   dominio específico si quieres restringirlo.
3. Opcionalmente, elige un **país** para ese sitio — el widget de ese sitio
   enfocará el chat y las "Ideas de mejora" en los documentos aplicables a
   ese país (además de los generales), sin que cada visitante tenga que
   indicarlo.
4. Haz clic en "Crear". Aparecerá en la tabla con un bloque de código
   (snippet) listo para copiar.

**Insertar el widget en un sitio**:

1. Copia el bloque de código completo de la columna "Snippet".
2. Pégalo en el HTML del sitio donde quieras que aparezca el asistente,
   justo antes de `</body>`.
3. Guarda y publica esa página. El botón 🆘 aparecerá automáticamente.

> Cada sitio tiene su propia clave (`site_key`). No es necesario crear un
> sitio nuevo por cada página — un mismo snippet puede copiarse en todas las
> páginas de un mismo sitio web.

---

## 5. Buenas prácticas operativas

- **Mantén los documentos actualizados**: el asistente solo es tan bueno como
  la información que tiene. Revisa periódicamente que los manuales y planes
  cargados sean la versión vigente.
- **Revisa las alertas generadas**: aunque el sistema redacta las alertas
  automáticamente con IA, el personal del COE debe validar la información
  antes de tomar decisiones operativas críticas — el asistente es una
  **herramienta de apoyo**, no un sustituto del juicio profesional.
- **Permisos del panel admin**: solo entrega credenciales del panel a
  personal autorizado para modificar documentos y configuración. El chat
  público (widget) no requiere cuenta y puede usarlo cualquier visitante del
  sitio.
- **Si algo no funciona**: revisa primero la sección "Solución de problemas
  comunes" de [SETUP.md](SETUP.md). Si el problema persiste, contacta a quien
  administra la infraestructura técnica (cuentas de Supabase/GitHub/etc.).

---

## 6. Preguntas frecuentes

**¿El asistente reemplaza el plan de emergencia oficial?**
No. Es una herramienta de consulta rápida basada en esos documentos. El plan
oficial sigue siendo la referencia autoritativa.

**¿El chat guarda las conversaciones?**
Sí, internamente se guarda un registro (pregunta, respuesta, fecha) para
revisión y mejora del servicio, visible solo desde la base de datos (no en el
panel admin en esta versión).

**¿Puedo usar el asistente desde el teléfono?**
Sí, el widget funciona en navegadores móviles. La lectura en voz alta y las
notificaciones dependen del navegador del dispositivo.

**¿Qué pasa si no hay internet?**
El asistente requiere conexión a internet (consulta servicios en la nube). No
funciona sin conexión.

**¿Puede monitorear redes sociales o noticias?**
Esa función está planeada para una fase futura (ver
[FASE2-RSS.md](FASE2-RSS.md)) y todavía no está activa.

**¿Cuánto tarda en revisarse un documento que envié?**
No hay un plazo fijo — depende de cuándo el equipo del COE revise la Bandeja
de entrada (puede ser minutos, días o semanas). Si dejaste un correo al
enviarlo, recibirás un aviso automático apenas sea aprobado o rechazado.

**¿Por qué no me llegó el correo de aprobación/rechazo?**
Revisa la carpeta de spam. También es posible que el sistema todavía no tenga
configurado el envío de correos (esto depende de quien administra el
sistema) — en ese caso, el documento se revisa igual, simplemente no se
envía el aviso por email.

**¿Qué pasa con un documento que es rechazado?**
Se elimina por completo del sistema. Si quieres que se reconsidere, puedes
volver a enviarlo desde **Enviar un documento**, idealmente con una
descripción más clara de por qué es relevante para la gestión de emergencias.
