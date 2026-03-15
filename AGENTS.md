# Datadog Presales Practice Simulator — Agent Guidelines

## Project Overview

AI-powered training simulator for Datadog DPN presales engineers. Users practice discovery calls,
scope POVs, handle scope creep, and sharpen value-selling skills by chatting with AI customer
personas and coaching agents.

The app is a Next.js client that streams responses from Google Gemini **via a server-side API
route**. It is deployed to Google Cloud Run as a two-container service (nginx proxy + Next.js app).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22 |
| Framework | Next.js 16 (App Router, `output: 'standalone'`) |
| Language | TypeScript 5.8 (strict `noEmit` type-checking) |
| UI | React 19, Tailwind CSS 4, Motion (framer-motion fork) |
| AI | Google Gemini via `@google/genai` (server-side streaming) |
| Observability | Datadog APM (`dd-trace`), RUM (`@datadog/browser-rum`), LLM Observability |
| Icons | lucide-react |
| Markdown | react-markdown |
| Deploy | Docker → Google Artifact Registry → Cloud Run |

## Project Structure

```
src/
  app/
    layout.tsx              # Root layout, metadata
    page.tsx                # Main SPA — exercise selection, chat UI, export
    globals.css             # Tailwind imports, markdown styling, fonts
    api/
      chat/
        route.ts            # POST /api/chat — validates input, streams Gemini response
  constants/
    knowledge.ts            # Customer profile + exercise reference data (internal, never expose)
  lib/
    logger.ts               # Winston structured logger (JSON, DD_LOGS_INJECTION compatible)
    llmobs.ts               # Re-exports tracer.llmobs singleton for LLM Observability
    utils.ts                # Shared utilities: cn() (clsx + tailwind-merge)
  services/
    chatClient.ts           # Browser-side fetch wrapper for /api/chat (streaming)
    geminiService.ts        # Server-side Gemini streaming, LLMObs instrumentation
  instrumentation.ts        # Next.js hook — initialises dd-trace + LLMObs before routes load
  types.ts                  # Shared types (Message, Exercise, Language, AIModel) and constants
server.ts                   # Custom HTTP server wrapping Next.js
next.config.mjs             # Standalone output, NEXT_PUBLIC_* env baking, source maps
deploy.sh                   # Cloud Run deployment script (two-container)
service.yaml                # Cloud Run service definition template (placeholder tokens)
Dockerfile                  # Multi-stage build: deps → builder → runner (serverless-init)
```

## Commands

| Command | Purpose |
|---------|---------|
| `npm install` | Install dependencies |
| `npm run dev` | Start dev server on http://localhost:3000 (tsx + Next.js) |
| `npm run build` | Production build |
| `npm run start` | Run production server |
| `npm run lint` | Type-check only (`tsc --noEmit`) — run this after any edit |
| `bash deploy.sh` | Build, push, and deploy to Cloud Run |

## Environment Variables

Copy `.env.example` to `.env` and fill in values before running locally. In Cloud Run, secrets
are injected at runtime from GCP Secret Manager — never hard-code them.

| Variable | Where set | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | `.env` / GCP Secret Manager | Gemini API — **server-side only**, never in the client bundle |
| `DD_API_KEY` | `.env` / GCP Secret Manager | Datadog ingestion key for APM + LLMObs agentless |
| `DD_RUM_APP_ID` | `.env` / Cloud Run env | Datadog RUM application ID (browser-safe, baked into client bundle) |
| `DD_RUM_CLIENT_TOKEN` | `.env` / Cloud Run env | Datadog RUM client token (browser-safe, baked into client bundle) |
| `DD_ENV` | `.env` / Cloud Run env | Datadog environment tag (default: `prod`) |
| `GCP_PROJECT_ID` | `.env` | GCP project ID for deploy.sh |
| `GCP_REGION` | `.env` | GCP region (e.g. `us-west1`) |
| `CR_SERVICE_NAME` | `.env` | Cloud Run service name |
| `ARTIFACT_REPO` | `.env` | Artifact Registry repo name |

`NEXT_PUBLIC_DD_VERSION`, `NEXT_PUBLIC_DD_RUM_APP_ID`, and `NEXT_PUBLIC_DD_RUM_CLIENT_TOKEN` are
baked into the browser bundle at build time via `next.config.mjs` — do not set them directly in
`.env`; set the source variables (`DD_VERSION`, `DD_RUM_APP_ID`, `DD_RUM_CLIENT_TOKEN`) instead.

## Code Conventions

### TypeScript

- Target ES2022.
- Types and shared constants live in `src/types.ts`; keep them co-located.
- Use explicit type annotations for function parameters and return types.
- Avoid `any` — use it only when interfacing with untyped third-party APIs (add a comment).

### React / Next.js

- The main UI is a single client component (`"use client"`) in `page.tsx`. State lives in `useState` hooks.
- Use functional components exclusively.
- Import `cn()` from `src/lib/utils` — do **not** re-define it inline.
- Browser-side API calls to `/api/chat` go through `streamGeminiChat` in `src/services/chatClient.ts` — do **not** call `fetch('/api/chat')` directly from the component.
- Animations use `motion` and `AnimatePresence` from the `motion/react` package.

### Styling

- Tailwind CSS 4 utility classes. No CSS-in-JS.
- Dark theme: background `#111` / `#191919`, accent `#632CA6` (Datadog purple), hover `#7742E6`.
- Fonts: Inter (sans), JetBrains Mono (mono) — loaded via Google Fonts in `globals.css`.
- Markdown rendered content is styled via `.markdown-body` class in `globals.css`.

### API Route (`/api/chat`)

- All Gemini API calls are server-side via `POST /api/chat`. **There are no direct browser-to-Gemini calls.**
- The route **must** validate all untrusted inputs before passing them to the service layer:
  - `exerciseId` — allowlisted against `EXERCISES` in `src/types.ts`
  - `modelId` — allowlisted against `AI_MODELS` in `src/types.ts`
  - `language` — allowlisted against `LANGUAGES` in `src/types.ts`
  - `messages` — array, max 200 items
  - `teamName` — max 80 characters
  - `sessionId` — max 128 characters
- The allowlists are derived directly from the `EXERCISES`, `AI_MODELS`, and `LANGUAGES` arrays — they update automatically when those arrays change.
- Errors are returned as `{ error: string }` with an appropriate HTTP status code.
- Stream errors are encoded as a null-byte-prefixed (`\x00`) sentinel chunk so the stream closes cleanly (avoids 502 from the nginx proxy). The client in `chatClient.ts` converts these back to thrown `Error` objects.

### AI / Gemini Service

- All AI logic lives in `src/services/geminiService.ts`.
- `GoogleGenAI` is a **module-level singleton** — do not instantiate it inside a function or per-request.
- `SYSTEM_PROMPT_TEMPLATE` in `geminiService.ts` is the **single source of truth** for the system instruction. The live API call derives `systemInstruction` by substituting `{{placeholder}}` variables from the template. Do not build a separate instruction string in parallel — they will diverge.
- Reference data in `src/constants/knowledge.ts` is internal-only AI context — never expose it to the user directly.
- Thinking mode is controlled by the `supportsThinking` flag on `AIModel` in `src/types.ts`, not by a model name prefix check.
- Retry logic uses exponential backoff (max 3 retries) for transient 503/429 errors from Gemini — only retries if no chunks have been streamed yet.
- Streaming chunks are passed to a callback; `fullResponse` accumulates the complete text for LLMObs annotation.

### Observability

- Use `logger` from `src/lib/logger` (Winston, JSON format) for all server-side logging — never `console.log`. `DD_LOGS_INJECTION` automatically enriches every log with the active trace/span IDs.
- LLMObs spans are created via `llmobs` from `src/lib/llmobs`. Regular chat turns get a single `llm` span; debrief requests are wrapped in a `task` span that annotates the full conversation for evaluation.
- RUM is initialised once on mount in `page.tsx`. The `allowedTracingUrls` config injects W3C trace-context headers into `/api/*` requests to link RUM sessions to APM traces.
- `datadogRum.setUser({ id: teamName, name: teamName })` is called when the team name is set so sessions are queryable by `usr.name` in the RUM Explorer.

### Naming

- Files: `camelCase.ts` / `camelCase.tsx` for source; `PascalCase` only for extracted React component files.
- Types: `PascalCase` (e.g., `Message`, `Exercise`, `AIModel`).
- Constants: `UPPER_SNAKE_CASE` for exported arrays/objects (e.g., `EXERCISES`, `AI_MODELS`, `LANGUAGES`).
- Functions: `camelCase`, prefix event handlers with `handle` (e.g., `handleSend`, `handleStartExercise`).

## Architecture Notes

- **Server-side AI calls**: `GEMINI_API_KEY` is a server-side secret. Gemini is called from `POST /api/chat`, never directly from the browser.
- **RUM tokens are browser-safe**: `DD_RUM_APP_ID` and `DD_RUM_CLIENT_TOKEN` are write-only tokens that can safely be baked into the client bundle.
- **Single-page flow**: Team name → Exercise selection → Chat → Debrief → Export. All state resets on "Reset".
- **Streaming UX**: Model responses appear incrementally. A loading indicator shows while waiting for the first chunk.
- **Session correlation**: The RUM session ID is passed to the API route as `sessionId` so APM, RUM, and LLMObs traces can all be correlated in Datadog.

## Deployment

Two-container Cloud Run service in `datadog-ese-sandbox` / `us-west1`:

1. **nginx-container** — AI Studio proxy (port 8080). `GEMINI_API_KEY` injected from GCP Secret Manager.
2. **app-container** — Next.js standalone app (port 3000). `GEMINI_API_KEY`, `DD_API_KEY`, and all Datadog config injected from GCP Secret Manager / Cloud Run env.

Auto-scaling: min **1**, max **30**. Session affinity enabled. CPU not throttled between requests.

`service.yaml` uses placeholder tokens substituted by `deploy.sh` at deploy time:

| Placeholder | Resolved from |
|---|---|
| `__APP_IMAGE__` | Built Docker image URI |
| `__SHORT_SHA__` | `git rev-parse --short HEAD` |
| `__FULL_SHA__` | `git rev-parse HEAD` |
| `__GIT_REPO_URL__` | `git config --get remote.origin.url` |
| `__DD_ENV__` | `DD_ENV` env var (default: `prod`) |
| `__APPLET_ID__` | `APPLET_ID` env var |
| `__APP_URL__` | `APP_URL` env var or derived from project number |
| `__GCP_PROJECT_NUMBER__` | `gcloud projects list --filter="projectId:..."` — auto-derived |

The GCP project number is resolved automatically by `deploy.sh` and must not be hard-coded in `service.yaml`.

## Adding a New Exercise

1. Add an `Exercise` entry to the `EXERCISES` array in `src/types.ts`.
2. Add reference data as a new exported constant in `src/constants/knowledge.ts`.
3. Wire it up in the `getExerciseReference()` switch in `src/services/geminiService.ts`.
4. Add an icon mapping in the `getExerciseIcon()` switch in `src/app/page.tsx`.

The route's input validation allowlist for `exerciseId` is auto-derived from `EXERCISES` — no additional change needed in `route.ts`.

## Adding a New AI Model

Add an `AIModel` entry to the `AI_MODELS` array in `src/types.ts`. Set `supportsThinking: true` if the model supports thinking mode. The service layer and route validation both read from this array — no additional wiring needed.

## Adding a New Language

Add a `Language` entry to the `LANGUAGES` array in `src/types.ts`. The language name is passed to the system instruction as a directive. Route validation is auto-derived from `LANGUAGES` — no additional change needed in `route.ts`.

## Security Rules

- **Never commit `.env` or `.env.local`** — only `.env.example` is tracked.
- **`GEMINI_API_KEY` is server-side only** — it must never appear in `NEXT_PUBLIC_*` variables or be passed to any client bundle. All Gemini calls go through `POST /api/chat`.
- **RUM tokens are browser-safe** — `DD_RUM_APP_ID` and `DD_RUM_CLIENT_TOKEN` are write-only tokens; it is safe to bake them into the client bundle as `NEXT_PUBLIC_*` vars.
- **Validate all API inputs** — `exerciseId`, `modelId`, and `language` are injected into LLM system prompts. Always validate them against the allowlists in `route.ts` to prevent prompt injection. Do not add new string fields to the API body without a corresponding validation rule.
- **`service.yaml` must use placeholder tokens** — the GCP project number, image URI, SHAs, and URLs must never be hard-coded in the template.
- **`productionBrowserSourceMaps: true` is intentional** — required for Datadog RUM Source Code Integration to map minified JS errors back to TypeScript.
- **`defaultPrivacyLevel: 'allow'` and 100% session replay are intentional** — this is an internal training tool; full replay capture is acceptable.
