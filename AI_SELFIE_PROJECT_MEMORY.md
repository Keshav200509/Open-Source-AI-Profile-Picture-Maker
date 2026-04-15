# AI Profile Picture Maker — Project Memory

## What This Project Is
A standalone web application that lets users upload a selfie and generate professional,
creative, or stylized profile pictures using open-source AI models.
No user accounts or logins required. All processing is server-side and stateless.
Images are stored temporarily and cleaned up automatically.

---

## History / Context
- This feature was originally prototyped inside `Keshav200509/corporate-blog` (Next.js).
- That prototype was reverted from the corporate blog (commit c77d7f6 on main).
- This repo is the **correct home** for the project as a fully standalone app.
- The prototype code (API routes, React UI, job store, AI service stubs) is complete
  and proven — it just needs to be rebuilt here with the proper tech stack below.

---

## Tech Stack

| Layer      | Technology |
|------------|------------|
| Frontend   | React 18 + Vite, Tailwind CSS, Axios |
| Backend    | Node.js 20, Express 5 |
| AI Services | rembg, Stable Diffusion WebUI, GFPGAN / CodeFormer (Docker containers) |
| Queue      | BullMQ + Redis (optional, for async job handling) |
| Storage    | Local filesystem (`temp/`) — no database |
| Deploy     | Docker Compose (all services), Render (backend) + Vercel (frontend) |

---

## Monorepo Directory Layout

```
/
├── frontend/          # React + Vite SPA
│   ├── src/
│   │   ├── components/
│   │   │   ├── UploadArea.tsx
│   │   │   ├── EditorCanvas.tsx
│   │   │   ├── StyleSelector.tsx
│   │   │   ├── BackgroundTool.tsx
│   │   │   ├── StatusIndicator.tsx
│   │   │   └── DownloadButton.tsx
│   │   ├── pages/
│   │   │   └── Home.tsx
│   │   ├── api/          # Axios wrappers for backend calls
│   │   └── main.tsx
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
│
├── backend/           # Express REST API
│   ├── src/
│   │   ├── routes/
│   │   │   ├── upload.ts
│   │   │   ├── status.ts
│   │   │   ├── removeBg.ts
│   │   │   ├── applyStyle.ts
│   │   │   ├── enhanceFace.ts
│   │   │   └── result.ts
│   │   ├── services/
│   │   │   ├── jobStore.ts       # In-memory Map + JSON persistence
│   │   │   ├── storage.ts        # Filesystem helpers (temp/)
│   │   │   ├── aiServices.ts     # rembg / SD / GFPGAN HTTP calls
│   │   │   └── cleanup.ts        # Delete files older than 1 hour
│   │   ├── types.ts
│   │   ├── config.ts
│   │   └── server.ts
│   ├── temp/              # Gitignored. Runtime upload + result storage.
│   └── package.json
│
├── docker-compose.yml    # Orchestrates all AI services + backend
├── .env.example
└── README.md
```

---

## REST API Endpoints (Express backend)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload` | Accept image (multipart), return `{ jobId }` |
| GET  | `/api/status/:jobId` | Return `{ status, resultUrl?, error? }` |
| POST | `/api/remove-bg/:jobId` | Trigger background removal (async, returns 202) |
| POST | `/api/apply-style/:jobId` | Apply style preset or custom prompt (async, 202) |
| POST | `/api/enhance-face/:jobId` | Face enhancement (async, 202) |
| GET  | `/api/result/:jobId` | Stream the final image file |
| POST | `/api/cleanup` | Manually trigger temp file cleanup (for cron) |

### Job States
`pending` → `processing` → `completed` | `failed`

### Request flow
1. Frontend uploads image → gets `jobId`
2. User triggers action (remove-bg, apply-style, enhance-face)
3. Backend sets status `processing`, kicks off async work, returns 202
4. Frontend polls `/api/status/:jobId` every 2 seconds
5. When `completed`, frontend fetches `/api/result/:jobId`

---

## AI Service Integrations

All services run as Docker containers. Backend calls them over HTTP.
When a service URL is **not configured**, the backend uses a **transparent mock**
(copies the file + simulates a 1-second delay) so the full pipeline can be tested
without GPU hardware.

### rembg — Background Removal
```
Docker image : danielgatis/rembg
Start        : rembg s   (default port 7000)
API call     : POST http://localhost:7000/
Form field   : file  (multipart)
Response     : PNG with transparent background
Env var      : REMBG_API_URL=http://localhost:7000
```

### Stable Diffusion WebUI — Style Transfer
```
Repo         : AUTOMATIC1111/stable-diffusion-webui
Port         : 7860
API call     : POST http://localhost:7860/sdapi/v1/img2img
Body (JSON)  : { init_images: [base64], prompt, negative_prompt,
                 denoising_strength: 0.65, steps: 30, cfg_scale: 7,
                 width: 512, height: 512 }
Response     : { images: [base64] }
Env var      : STABLE_DIFFUSION_URL=http://localhost:7860
```

### GFPGAN — Face Enhancement
```
Wrapper      : FastAPI around GFPGAN
Port         : 8000
API call     : POST http://localhost:8000/restore
Form field   : image  (multipart)
Response     : JPEG
Env var      : GFPGAN_API_URL=http://localhost:8000
```

---

## Style Presets (7 total)

| id | Label | Prompt summary |
|----|-------|----------------|
| `professional` | Professional | Corporate headshot, office background, formal |
| `casual` | Casual | Natural outdoor, friendly, relaxed |
| `fantasy` | Fantasy | Magical forest, epic lighting, high fantasy |
| `cyberpunk` | Cyberpunk | Neon lights, futuristic city, rain |
| `watercolor` | Watercolor | Soft pastel, impressionist brush strokes |
| `anime` | Anime | Cell-shaded, vibrant, studio ghibli style |
| `oil-painting` | Oil Painting | Renaissance, rich warm colors, chiaroscuro |

---

## Data / Storage Design (No Database)

- Every job gets a UUID (`crypto.randomUUID()`)
- Files stored at `backend/temp/{jobId}/original.jpg` and `result.jpg`
- Job metadata kept in an **in-memory Map** with JSON file persistence
  (`backend/temp/_jobs.json`) so jobs survive hot-reloads
- Cleanup runs on server start + every hour: deletes dirs older than **1 hour**
- No user model, no auth, no credits

---

## Environment Variables

```env
# Backend
PORT=4000
REMBG_API_URL=               # leave blank for mock mode
GFPGAN_API_URL=              # leave blank for mock mode
STABLE_DIFFUSION_URL=        # leave blank for mock mode
CLEANUP_INTERVAL_MS=3600000  # 1 hour
MAX_FILE_SIZE_MB=10

# Frontend (Vite)
VITE_API_BASE_URL=http://localhost:4000
```

---

## Docker Compose Layout

```yaml
services:
  backend:
    build: ./backend
    ports: ["4000:4000"]
    volumes: ["./backend/temp:/app/temp"]
    env_file: .env

  rembg:
    image: danielgatis/rembg
    command: s
    ports: ["7000:7000"]

  gfpgan:
    build: ./docker/gfpgan     # custom FastAPI wrapper
    ports: ["8000:8000"]
    deploy:
      resources:
        reservations:
          devices: [{capabilities: [gpu]}]

  stable-diffusion:
    image: <sd-webui-image>
    ports: ["7860:7860"]
    deploy:
      resources:
        reservations:
          devices: [{capabilities: [gpu]}]
```

---

## Frontend UX Flow

1. **Upload screen** — Large drag-and-drop zone, "Choose Photo" button, accepts JPG/PNG/WebP ≤ 10 MB
2. **Editor screen** (after upload) — side-by-side Original | Result panels
3. **Transformations panel**:
   - Action buttons: `✂️ Remove Background`, `✨ Enhance Face`, `🎨 Apply Style`
   - Style preset grid (7 cards with emoji icons)
   - Status indicator: spinner + message while processing
4. **Download** — Available when status = `completed`; "Start Over" resets to upload screen
5. **Error states** — Banner with dismissible error message

---

## Key Implementation Notes

- **Multer** for multipart file uploads in Express
- **CORS** enabled on backend for Vite dev server (`localhost:5173`)
- **Polling** every 2 seconds via `setInterval` — stop on `completed` or `failed`
- **File extension** derived from MIME type if not in filename
- **Result endpoint** streams file with `Content-Disposition: inline`
- Backend processes AI tasks **asynchronously** (fire-and-forget) so HTTP response
  returns immediately (202 Accepted) — frontend polls for completion
- All allowed MIME types: `image/jpeg`, `image/png`, `image/webp`

---

## What Was Already Validated

The following logic was built and type-checked in the corporate-blog prototype
and can be ported directly:

- `jobStore.ts` — Map + JSON persistence pattern ✅
- `storage.ts` — `saveFile`, `readFile`, `deleteJobDir`, `imageFilename` ✅
- `aiServices.ts` — rembg / SD / GFPGAN HTTP call patterns + mock fallback ✅
- `cleanup.ts` — age-based file purge ✅
- `types.ts` — `SelfieJob`, `JobStatus`, `StylePreset`, `ApiResponse` ✅
- React page — upload, polling, style selector, before/after panels, download ✅

All of these are ready to be adapted from Next.js API routes → Express routes
and from Next.js page → standalone Vite React app.
