# AI Profile Picture Maker

A self-hosted web application that transforms your selfie into professional or creative profile pictures using open-source AI models. No account or login required.

## Features

- **Background Removal** — powered by [rembg](https://github.com/danielgatis/rembg)
- **Style Transfer** — 7 AI presets (Professional, Casual, Fantasy, Cyberpunk, Watercolor, Anime, Oil Painting) via Stable Diffusion
- **Face Enhancement** — powered by [GFPGAN](https://github.com/TencentARC/GFPGAN)
- **No database** — images stored temporarily in `backend/temp/` and cleaned up after 1 hour
- **Mock mode** — all AI services fall back to a transparent passthrough if not configured, so the full UI/API pipeline works without a GPU

## Tech Stack

| Layer      | Technology |
|------------|------------|
| Frontend   | React 18 + Vite, Tailwind CSS, Axios |
| Backend    | Node.js 20, Express, TypeScript |
| AI Services | rembg, Stable Diffusion WebUI, GFPGAN (Docker containers) |
| Storage    | Local filesystem (`temp/`) — no database |
| Deploy     | Docker Compose |

## Deploy to the Cloud (Recommended — no local setup needed)

The app runs in **mock mode** on free cloud tiers (AI transformations return the original image after a 1-second delay). This is enough to test the full upload → transform → download flow. Real AI requires connecting a GPU server later.

### Step 1 — Deploy backend to Render (free)

1. Go to [render.com](https://render.com) → **New → Blueprint**
2. Connect your GitHub repo — Render will pick up `render.yaml` automatically
3. Click **Apply** — the backend deploys to `https://ai-profile-backend.onrender.com`
4. Copy that URL

### Step 2 — Deploy frontend to Vercel (free)

1. Go to [vercel.com](https://vercel.com) → **New Project**
2. Import the GitHub repo, set **Root Directory** to `frontend`
3. Add environment variable:
   ```
   VITE_API_BASE_URL = https://ai-profile-backend.onrender.com
   ```
4. Click **Deploy** — the frontend is live at `https://your-project.vercel.app`

That's it. No local installation needed.

---

## Local Development (optional)

```bash
cd backend && npm install && npm run dev   # :4000
cd frontend && npm install && npm run dev  # :5173
```

## Full Setup with Docker Compose (with GPU)

```bash
cp .env.example .env
# Edit .env to point AI service URLs at Docker containers

docker compose up --build
```

For GPU support, uncomment the `deploy.resources` sections in `docker-compose.yml`.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload` | Upload image → `{ jobId }` |
| GET  | `/api/status/:jobId` | Poll job status |
| POST | `/api/remove-bg/:jobId` | Trigger background removal (202 async) |
| POST | `/api/apply-style/:jobId` | Apply style preset (202 async) |
| POST | `/api/enhance-face/:jobId` | Enhance face (202 async) |
| GET  | `/api/result/:jobId` | Download the result image |
| POST | `/api/cleanup` | Manually trigger temp file cleanup |

## Style Presets

| Preset | Description |
|--------|-------------|
| `professional` | Corporate headshot, formal attire |
| `casual` | Natural outdoor, relaxed |
| `fantasy` | Magical forest, epic lighting |
| `cyberpunk` | Neon lights, futuristic city |
| `watercolor` | Soft pastel, impressionist |
| `anime` | Cell-shaded, Studio Ghibli style |
| `oil-painting` | Renaissance, chiaroscuro |

## Environment Variables

See `.env.example` for all variables. Leave AI service URLs blank to run in mock mode.

## Project Structure

```
/
├── frontend/          # React + Vite SPA
│   └── src/
│       ├── components/   # UploadArea, EditorCanvas, StyleSelector, etc.
│       ├── pages/        # Home.tsx
│       └── api/          # Axios wrappers
├── backend/           # Express REST API
│   └── src/
│       ├── routes/       # upload, status, removeBg, applyStyle, enhanceFace, result
│       └── services/     # jobStore, storage, aiServices, cleanup
├── docker/
│   └── gfpgan/        # FastAPI wrapper for GFPGAN
└── docker-compose.yml
```

## License

MIT
