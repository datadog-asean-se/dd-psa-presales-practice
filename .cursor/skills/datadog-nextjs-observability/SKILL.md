---
name: datadog-nextjs-observability
description: >
  Integrate Datadog APM, RUM, LLM Observability, and structured logging into
  Node.js (Next.js) applications deployed as containers on Google Cloud Run.
  Use when the user wants to: (1) add Datadog tracing / APM to a Next.js
  Cloud Run container using the in-container serverless-init method,
  (2) add Datadog RUM (Real User Monitoring) to a React/Next.js frontend,
  (3) add Datadog LLM Observability for Node.js with the in-code SDK setup,
  (4) correlate APM, RUM, and LLMObs traces together,
  (5) set up structured logging with winston + DD_LOGS_INJECTION,
  (6) configure Dockerfile, service.yaml, deploy.sh, or next.config.mjs for
  Datadog integration, (7) enable Datadog Source Code Integration with
  DD_GIT_* env vars, or (8) troubleshoot dd-trace, serverless-init, or
  NEXT_PUBLIC_* build-time vs runtime issues in Next.js.
---

# Datadog Next.js Observability

End-to-end guide for instrumenting a Next.js (App Router) application with
Datadog APM, RUM, LLM Observability, and structured logging, deployed as a
container on Google Cloud Run using the **in-container** method.

## Architecture Overview

```
Browser (RUM SDK)
  ├─ allowedTracingUrls → injects trace-context headers into /api/* fetches
  └─ session_id passed in request body for LLMObs correlation
      │
      ▼
Cloud Run container
  ├─ datadog/serverless-init:1  (ENTRYPOINT — flushes traces on shutdown)
  ├─ dd-trace (in-code init via instrumentation.ts)
  │    ├─ APM spans  → Datadog Agent intake
  │    └─ LLMObs spans → Datadog LLMObs intake (agentless)
  ├─ winston logger  (JSON, DD_LOGS_INJECTION auto-enriches with trace IDs)
  └─ Next.js standalone server (node --enable-source-maps server.js)
```

## Key Files Checklist

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage build; serverless-init; dd-trace install; source maps |
| `service.yaml` | Cloud Run YAML with DD_* env vars, Secret Manager refs |
| `deploy.sh` | Build, push, render service.yaml placeholders, deploy |
| `next.config.mjs` | `serverExternalPackages`, `productionBrowserSourceMaps`, `NEXT_PUBLIC_DD_VERSION` |
| `src/instrumentation.ts` | In-code dd-trace + LLMObs init (Next.js `register()` hook) |
| `src/lib/llmobs.ts` | Re-export `tracer.llmobs` singleton |
| `src/lib/logger.ts` | Winston JSON logger |
| `src/app/page.tsx` | RUM init, `setUser`, `setGlobalContextProperty`, `allowedTracingUrls` |
| `src/app/api/chat/route.ts` | API Route Handler — bridges client to server-side LLM calls |
| `src/services/geminiService.ts` | `llmobs.trace`, `llmobs.annotate`, `llmobs.annotationContext` |

## Workflow

### 1. APM + Container Setup

See [references/apm-container.md](references/apm-container.md) for:
- Dockerfile multi-stage build with `datadog/serverless-init:1`
- `service.yaml` DD_* environment variables and Secret Manager integration
- `deploy.sh` build-arg and sed-placeholder patterns
- `next.config.mjs` configuration for dd-trace compatibility

### 2. LLM Observability

See [references/llmobs.md](references/llmobs.md) for:
- In-code dd-trace init via `src/instrumentation.ts` (Next.js `register()`)
- `llmobs.trace()` span kinds: `llm`, `task`, `workflow`, `agent`, `tool`
- `llmobs.annotate()` for input/output data, metadata, and tags
- `llmobs.annotationContext()` for prompt tracking with auto-versioning
- Task spans for evaluation targeting (e.g. debrief quality scoring)

### 3. RUM + Correlation

See [references/rum.md](references/rum.md) for:
- `@datadog/browser-rum` initialization in a client component
- `allowedTracingUrls` for APM-RUM trace correlation
- `datadogRum.setUser()` and `setGlobalContextProperty()` for user/team tagging
- RUM session ID propagation to LLMObs via `getInternalContext().session_id`

### 4. Structured Logging

See [references/logging.md](references/logging.md) for:
- Winston logger with JSON format
- `DD_LOGS_INJECTION=true` for automatic trace ID enrichment
- Log correlation with APM traces in Datadog

## Critical Gotchas

1. **Never combine `NODE_OPTIONS="--require dd-trace/init"` with in-code init.**
   Use one or the other. For Next.js App Router, use in-code init via `instrumentation.ts`.

2. **`NEXT_PUBLIC_*` variables must be available at `next build` time**, not just
   Cloud Run runtime. Pass them as Docker `--build-arg` and set `ARG`/`ENV` in the
   builder stage of the Dockerfile before `npm run build`.

3. **`serverExternalPackages: ['dd-trace']`** is required in `next.config.mjs`.
   Without it, webpack bundles dd-trace and breaks runtime monkey-patching.

4. **dd-trace must be installed separately in the runner stage** with
   `RUN npm install --no-save dd-trace` because Next.js standalone output
   doesn't include it and its native deps (dc-polyfill, @datadog/pprof).

5. **Quote all-digit git SHAs in YAML** — a short SHA like `6160312` is parsed
   as an integer by YAML, causing Cloud Run deployment to fail. Always quote:
   `value: '__SHORT_SHA__'`

6. **`--enable-source-maps`** in the Node.js CMD enables TypeScript source map
   resolution for APM error stack traces and Datadog Error Tracking.

7. **`agentlessEnabled: true`** in llmobs config sends LLM data directly to
   Datadog intake using DD_API_KEY. APM traces still go through serverless-init.
