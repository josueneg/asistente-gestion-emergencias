# Fase 2 — Monitoreo de noticias y redes sociales (diseño, no implementado)

Este documento describe cómo se ampliaría el sistema para detectar
publicaciones relevantes a emergencias (accidentes, inundaciones,
desprendimientos, etc.) provenientes de medios y redes sociales,
**reutilizando** la infraestructura de Fase 1 (tabla `alerts`, widget,
notificaciones) sin modificarla.

> **Estado**: diseño únicamente. Nada de esto está implementado todavía. Se
> documenta para que pueda construirse después sin rediseñar el sistema.

## Por qué se dejó para después

Las APIs oficiales de redes sociales (X/Twitter, Facebook/Meta, Instagram)
dejaron de ofrecer niveles gratuitos útiles para monitoreo continuo, o
requieren aprobaciones/costos que rompen el objetivo "100% gratis". La
alternativa viable sin costo es monitorear **fuentes RSS de medios de
noticias**, que sí están disponibles y son de acceso público.

## Fuentes RSS confirmadas

| Medio | URL del feed |
|---|---|
| La Prensa | `https://www.prensa.com/arc/outboundfeeds/rss/?outputType=xml` |
| Telemetro (Nacionales) | `https://www.telemetro.com/rss/pages/nacionales.xml` |

Otros medios panameños relevantes (TVN, Critica, SINAPROC) no publican RSS
público conocido al momento de este diseño; incorporarlos requeriría
"scraping" (leer y analizar el HTML de la página), lo cual es más frágil
(se rompe si el sitio cambia de diseño) y debe evaluarse caso por caso.

## Cambios en la base de datos

Nueva tabla, sin tocar las existentes:

```sql
create table news_items (
  id uuid primary key default gen_random_uuid(),
  source text not null,           -- ej. 'La Prensa', 'Telemetro'
  url text not null unique,       -- enlace al artículo (evita duplicados)
  title text not null,
  summary text,
  published_at timestamptz,
  is_relevant boolean,            -- resultado de la clasificación por IA
  alert_id uuid references alerts(id),
  created_at timestamptz default now()
);

create index news_items_url_idx on news_items (url);
```

El `unique` en `url` permite usar `on conflict do nothing` al insertar, para
no procesar dos veces el mismo artículo.

## Flujo propuesto

1. **Nuevo workflow** `.github/workflows/rss-check.yml`, con `cron` cada
   30-60 minutos (las noticias no cambian tan rápido como el clima, y esto
   reparte mejor el uso de la cuota gratuita de Groq).

2. **Nuevo script** `scripts/rss-check.mjs` (mismo estilo que
   `weather-check.mjs`, Node sin dependencias):
   - Descarga y parsea cada feed RSS (XML simple, se puede leer con
     expresiones regulares o un parser XML minimalista en Node).
   - Para cada artículo nuevo (cuya `url` no exista ya en `news_items`),
     guarda un registro inicial con `is_relevant = null`.

3. **Clasificación con IA**: para cada artículo nuevo, se envía
   título + resumen a Groq con un prompt tipo:

   > "¿Esta noticia describe una emergencia activa o reciente en Panamá
   > (accidente, inundación, incendio, colapso estructural, deslizamiento,
   > etc.)? Responde en JSON: `{relevante: bool, tipo: string, severidad:
   > "bajo"|"medio"|"alto", resumen: string}`."

   Esto puede hacerse en el mismo script (llamando directo a Groq, igual que
   `weather-alert` lo hace desde la Edge Function) o agregando una nueva Edge
   Function `news-alert` análoga a `weather-alert`, por consistencia con el
   patrón de Fase 1 (recomendado: nueva Edge Function, para no exponer
   `GROQ_API_KEY` en GitHub Actions).

4. **Reutilización del pipeline de alertas**: si `relevante = true`, se
   inserta en `alerts` con `type = 'news'` (en lugar de `'weather'`), y se
   guarda el `alert_id` en el `news_items` correspondiente.

5. **Widget**: no requiere cambios. Ya muestra cualquier fila de `alerts`
   sin importar su `type`; basta con que `widget.js` use un color/icono
   distinto si `type === 'news'` (cambio menor y opcional en
   `renderAlert`/`showToast`).

## Consideraciones adicionales

- **Filtrado geográfico/temático**: el prompt de clasificación debe dejar
  claro que solo interesan eventos en Panamá (o la región de cobertura del
  COE) y de tipo emergencia — para evitar alertas de noticias irrelevantes
  (deportes, política, etc.).
- **Volumen**: si los feeds traen muchos artículos por ciclo, conviene
  limitar cuántos se clasifican por ejecución (ej. los 10 más recientes) para
  no agotar la cuota gratuita de Groq.
- **Duplicados entre fuentes**: dos medios pueden cubrir el mismo evento. Una
  mejora futura sería agrupar/deduplicar por similitud antes de generar una
  alerta, pero no es necesario para una primera versión.
- **Ampliación a más fuentes**: si en el futuro se encuentran feeds RSS de
  SINAPROC, ETESA u otras instituciones, se agregan simplemente a la lista de
  fuentes del script — el resto del flujo no cambia.
