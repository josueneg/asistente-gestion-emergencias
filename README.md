# Asistente IA - COE Panamá

Asistente de inteligencia artificial **gratuito**, embebible en cualquier sitio web, pensado para apoyar a un Centro de Operaciones de Emergencia (COE) en Panamá.

## ¿Qué hace?

1. **Responde preguntas y da recomendaciones** basándose en los documentos del COE (manuales y planes de emergencia en PDF, Word o Excel) que tú mismo subas.
2. **Monitorea el clima de Panamá las 24 horas**, comparando varios modelos meteorológicos a la vez, y genera alertas redactadas por IA cuando detecta riesgo.
3. **Notifica** las alertas nuevas dentro del widget de forma visual (aviso en pantalla) y hablada (voz en español).
4. Incluye un **panel de administración** para subir documentos y configurar los umbrales de alerta de clima.

Todo funciona sobre servicios con plan gratuito: GitHub, Groq, Google AI Studio, Supabase y Cloudflare Pages.

## Documentación

| Documento | Para quién | Contenido |
|---|---|---|
| [docs/SETUP.md](docs/SETUP.md) | Quien instala el sistema | Guía paso a paso: crear cuentas gratuitas, desplegar la base de datos, las funciones y el widget |
| [docs/MANUAL_USUARIO.md](docs/MANUAL_USUARIO.md) | Personal del COE | Cómo usar el chat, las alertas, el panel de administración y cómo capacitar a otras personas |
| [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) | Quien dé mantenimiento | Cómo está construido el sistema y por qué |
| [docs/FASE2-RSS.md](docs/FASE2-RSS.md) | Quien dé mantenimiento | Diseño para añadir, en el futuro, monitoreo de noticias/redes vía RSS |

## Estructura del proyecto

```
coe-panama-asistente/
├── supabase/            # Base de datos (pgvector) y funciones backend (Edge Functions)
├── scripts/             # Script del monitoreo de clima
├── .github/workflows/   # Cron 24/7 que ejecuta el monitoreo de clima
├── widget/              # El asistente embebible (<script>) que se inserta en cualquier web
├── admin/               # Panel de administración (subir documentos, configurar alertas)
└── docs/                # Toda la documentación
```

## Inicio rápido

1. Sigue **[docs/SETUP.md](docs/SETUP.md)** para crear las cuentas gratuitas necesarias y desplegar el sistema (toma entre 30 y 60 minutos, no requiere experiencia previa).
2. Una vez desplegado, sigue **[docs/MANUAL_USUARIO.md](docs/MANUAL_USUARIO.md)** para aprender a usarlo y capacitar a tu equipo.
