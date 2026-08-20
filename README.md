npm

# Transcripto

Aplicación full-stack para transcribir, resumir, analizar y conversar con tus audios usando **OpenAI Whisper** (transcripción) y **GPT-4** (análisis).

Pensada para audios en **español** que pueden incluir palabras o frases en inglés. La transcripción es precisa, los resúmenes y puntos clave se generan en español por defecto, y puedes hacer un chat estilo "pregúntale al audio" para extraer conclusiones rápidamente.

## Funcionalidades

- **Subida de audio** con drag & drop (mp3, m4a, wav, ogg, webm, flac, mp4...)
- **Archivos grandes (>25MB) sin problema** — compresión automática a mp3 mono 32kbps + chunking en segmentos de 10 min que se transcriben en paralelo y se unen ajustando timestamps. Funciona con audios de 1–3+ horas.
- **Transcripción con Whisper** auto-detección de idioma y segmentos con timestamps
- **Reproductor sincronizado** que resalta el segmento actual mientras suena
- **Resumen breve + detallado** con tópicos y sentimiento (GPT-4)
- **Puntos clave categorizados** (Acción, Decisión, Idea, Riesgo, Pregunta, Dato...) con nivel de importancia y check para marcar lo completado
- **Chat con el audio** — pregúntale lo que quieras, responde en base al contenido
- **Notas libres** — anotaciones manuales por transcripción
- **Carpetas** para organizar por proyecto, tema o cliente
- **Búsqueda** en títulos y dentro del texto transcrito
- **UI moderna** con shadcn/ui + Tailwind, modo claro/oscuro, responsive

## Stack

| Capa          | Tecnología                                      |
| ------------- | ------------------------------------------------ |
| Framework     | Next.js 15 (App Router) + TypeScript             |
| UI            | Tailwind CSS + shadcn/ui + lucide icons          |
| Estado / data | TanStack Query + Zustand                         |
| DB            | PostgreSQL + Prisma                              |
| IA            | OpenAI SDK — Whisper + GPT-4                    |
| Auth          | (no incluido — añade NextAuth si lo necesitas) |

## Setup

### 1. Requisitos

- Node.js 20+
- PostgreSQL 14+ corriendo en local (o usa Supabase, Neon, Railway…)
- Una API key de OpenAI con créditos

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar entorno

Copia el archivo de ejemplo y edítalo con tus valores:

```bash
cp .env.example .env
```

Edita `.env`:

```env
DATABASE_URL="postgresql://USUARIO:PASSWORD@localhost:5432/transcripcion?schema=public"
OPENAI_API_KEY="sk-tu-clave-de-openai"
OPENAI_TRANSCRIPTION_MODEL="whisper-1"
OPENAI_CHAT_MODEL="gpt-4o-mini"
MAX_UPLOAD_MB="500"
UPLOAD_DIR="./uploads"
```

> `gpt-4o-mini` es buena relación calidad/precio. Para máxima calidad usa `gpt-4o`.

### 4. Crear la base de datos

Asegúrate de que la base existe en Postgres:

```bash
createdb transcripcion
```

Aplica el schema:

```bash
npm run db:push
```

(O `npm run db:migrate` si quieres historial de migraciones.)

### 5. Arrancar en desarrollo

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

### 6. Producción

```bash
npm run build
npm start
```

## Comandos útiles

```bash
npm run dev          # dev server
npm run build        # build producción
npm start            # arrancar build de producción
npm run db:push      # sincronizar schema con la DB (sin migraciones)
npm run db:migrate   # crear y aplicar migración
npm run db:studio    # abrir Prisma Studio para inspeccionar la DB
npm run db:generate  # regenerar Prisma client
```

## Estructura

```
transcripcion/
├── app/
│   ├── api/                            # Endpoints
│   │   ├── transcriptions/             # CRUD + audio streaming
│   │   │   └── [id]/
│   │   │       ├── audio/              # Streaming con range requests
│   │   │       ├── chat/               # Conversación con GPT-4
│   │   │       ├── key-points/         # Extracción de puntos clave
│   │   │       ├── notes/              # Notas libres
│   │   │       └── summary/            # Resumen
│   │   ├── folders/                    # Carpetas
│   │   ├── key-points/[id]/            # PATCH/DELETE de un punto
│   │   ├── notes/[id]/                 # PATCH/DELETE de una nota
│   │   └── stats/                      # Estadísticas dashboard
│   ├── transcriptions/
│   │   ├── page.tsx                    # Lista
│   │   └── [id]/page.tsx               # Detalle
│   ├── upload/page.tsx                 # Subir audio
│   ├── layout.tsx                      # Layout con sidebar
│   ├── page.tsx                        # Dashboard
│   ├── error.tsx
│   └── not-found.tsx
├── components/
│   ├── ui/                             # shadcn (button, card, dialog…)
│   ├── audio-player.tsx
│   ├── audio-uploader.tsx
│   ├── chat-section.tsx
│   ├── key-points-section.tsx
│   ├── notes-section.tsx
│   ├── providers.tsx
│   ├── sidebar.tsx                     # Navegación lateral + carpetas
│   ├── mobile-nav.tsx
│   ├── summary-section.tsx
│   ├── transcript-view.tsx             # Texto con segmentos clicables
│   ├── transcription-card.tsx
│   ├── transcription-detail.tsx
│   └── transcription-list.tsx
├── lib/
│   ├── analysis.ts                     # GPT-4 (resumen, puntos, chat)
│   ├── db.ts                           # Prisma client
│   ├── openai.ts                       # Cliente OpenAI
│   ├── storage.ts                      # Guardado de archivos
│   ├── transcribe.ts                   # Llamada a Whisper
│   ├── utils.ts                        # Helpers (cn, formatBytes…)
│   └── validators.ts                   # Zod schemas
└── prisma/
    └── schema.prisma                   # Modelo de datos
```

## Modelo de datos

```
Folder        (carpetas para organizar)
  └─ Transcription
       ├─ Summary       (resumen breve + detallado + tópicos + sentimiento)
       ├─ KeyPoint[]    (puntos clave categorizados con importancia)
       ├─ Note[]        (anotaciones manuales)
       ├─ ChatMessage[] (historial de la conversación con el audio)
       └─ Tag[]
```

## Flujo de uso

1. **Subes un audio** desde `/upload` (o el botón flotante)
2. El backend guarda el archivo en `uploads/` y lo envía a Whisper
3. Cuando termina, ves la transcripción en `/transcriptions/[id]`
4. Desde ahí puedes:
   - **Reproducir** el audio y ver el texto seguir el playback
   - Hacer click en segmentos para saltar a ese momento del audio
   - Generar **resumen** con un botón
   - Extraer **puntos clave** con un botón
   - Iniciar un **chat** con el audio para preguntarle lo que quieras
   - Agregar **notas** propias

## Costos OpenAI (aprox. en USD)

| Modelo                                    | Coste                                        |
| ----------------------------------------- | -------------------------------------------- |
| Whisper-1                                 | $0.006 / minuto de audio                     |
| GPT-4o-mini (resumen, puntos clave, chat) | $0.15 / 1M tokens input · $0.60 / 1M output |
| GPT-4o (alta calidad)                     | $2.50 / 1M input · $10 / 1M output          |

Una transcripción típica de 10 minutos cuesta ~$0.06 + ~$0.005 en análisis si usas `gpt-4o-mini`.

## Audios grandes — cómo funciona

El límite de Whisper son 25 MB por archivo. Tu app maneja audios mucho más grandes automáticamente:

1. **Si el archivo ≤ 24MB** → se envía directo a Whisper.
2. **Si es mayor** → `ffmpeg` lo recomprime a **mp3 mono 32 kbps** (excelente calidad para voz, ~14 MB/hora).
3. **Si el comprimido sigue siendo >24MB** → se trocea en **chunks de 10 minutos** (`ffmpeg -f segment`), se transcribe cada chunk en paralelo, y se unen los textos y segmentos ajustando los timestamps al offset correcto.

`ffmpeg` y `ffprobe` vienen incluidos como dependencias npm (`ffmpeg-static`, `ffprobe-static`) — no tienes que instalar nada extra en tu sistema.

| Audio original  | Comprimido          | Chunks             | Tiempo aprox.     |
| --------------- | ------------------- | ------------------ | ----------------- |
| 200 MB / 1h wav | ~14 MB / 32kbps mp3 | 1                  | ~30s              |
| 200 MB / 3h wav | ~43 MB              | 5 chunks × 10 min | ~1 min (paralelo) |
| 500 MB / 5h     | ~72 MB              | 8 chunks × 10 min | ~1.5 min          |

## Notas

- **Procesamiento síncrono**: las llamadas a Whisper se hacen en el momento de la subida. Para audios muy largos en producción, mueve la transcripción a un job queue (BullMQ, Inngest, etc).
- **Almacenamiento local**: los audios se guardan en `./uploads`. Para producción en serverless (Vercel) tendrás que usar S3, R2, GCS o similar — el código de `lib/storage.ts` está aislado para facilitarlo.
- **Sin autenticación**: este proyecto asume single-user (tú). Para multi-usuario añade NextAuth y un campo `userId` en cada modelo.

## Ideas para extender

- Auth (NextAuth + Google)
- Cola de jobs para audios largos
- Subida directa a S3 con presigned URLs
- Exportar resumen + puntos como PDF / Notion / Markdown
- Diarización (separar speakers) usando WhisperX o pyannote
- Buscar dentro del audio por texto y saltar al timestamp
- Webhooks para notificar cuando una transcripción esté lista
- Etiquetas y filtros avanzados

## Licencia

MIT
