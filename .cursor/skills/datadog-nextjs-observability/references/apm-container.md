# APM In-Container Setup for Next.js on Cloud Run

## Table of Contents

- [Dockerfile](#dockerfile)
- [service.yaml](#serviceyaml)
- [deploy.sh](#deploysh)
- [next.config.mjs](#nextconfigmjs)
- [Source Code Integration](#source-code-integration)

## Dockerfile

Multi-stage build pattern for Next.js + Datadog APM:

```dockerfile
# ---- deps stage ----
FROM node:22-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder stage ----
FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1

# DD_VERSION must be available at build time for NEXT_PUBLIC_DD_VERSION
ARG DD_VERSION
ENV DD_VERSION=$DD_VERSION

RUN mkdir -p public
RUN npm run build

# ---- runner stage ----
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# SSL certs for serverless-init on slim images
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

# Datadog serverless-init: wraps the app process, flushes APM data on shutdown
COPY --from=datadog/serverless-init:1 /datadog-init /app/datadog-init

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

# Next.js standalone output
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# dd-trace + native deps must be installed in runner (not copied from builder)
RUN npm install --no-save dd-trace

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# In-code init via instrumentation.ts — do NOT set NODE_OPTIONS="--require dd-trace/init"
# --enable-source-maps for Datadog Error Tracking / Code Origin
ENTRYPOINT ["/app/datadog-init"]
CMD ["node", "--enable-source-maps", "server.js"]
```

### Key points

- `datadog/serverless-init:1` acts as the ENTRYPOINT, wrapping the Node.js process
- `npm install --no-save dd-trace` in runner stage resolves native deps (dc-polyfill, @datadog/pprof)
- `ARG DD_VERSION` + `ENV DD_VERSION` in builder stage makes the git SHA available to `next build`
- `--enable-source-maps` enables stack trace resolution to original TypeScript source

## service.yaml

Cloud Run YAML with Datadog environment variables:

```yaml
env:
  - name: DD_API_KEY
    valueFrom:
      secretKeyRef:
        name: DD_API_KEY
        key: latest
  - name: DD_SITE
    value: datadoghq.com
  - name: DD_ENV
    value: __DD_ENV__           # replaced by deploy.sh
  - name: DD_SERVICE
    value: my-service-name
  - name: DD_LOGS_ENABLED
    value: 'true'
  - name: DD_LOGS_INJECTION
    value: 'true'
  - name: DD_VERSION
    value: '__SHORT_SHA__'      # MUST be quoted — all-digit SHAs break YAML
  - name: DD_SOURCE
    value: nodejs
  - name: DD_TAGS
    value: team:my-team
  - name: DD_GIT_COMMIT_SHA
    value: '__FULL_SHA__'       # MUST be quoted
  - name: DD_GIT_REPOSITORY_URL
    value: __GIT_REPO_URL__
  - name: DD_LLMOBS_ENABLED
    value: '1'
  - name: DD_LLMOBS_ML_APP
    value: my-ml-app-name
```

### Secret Manager integration

API keys use `secretKeyRef` to pull from GCP Secret Manager at runtime:
```yaml
- name: DD_API_KEY
  valueFrom:
    secretKeyRef:
      name: DD_API_KEY          # Secret name in GCP Secret Manager
      key: latest               # Secret version
```

## deploy.sh

Key patterns in the deployment script:

```bash
# Git metadata for Datadog
SHORT_SHA=$(git rev-parse --short HEAD)
FULL_SHA=$(git rev-parse HEAD)
GIT_REPO_URL=$(git config --get remote.origin.url)
# Unique tag forces new Cloud Run revision on every deploy
BUILD_TAG="${SHORT_SHA}-$(date +%s)"

# Pass DD_VERSION as build-arg so next build can bake it into NEXT_PUBLIC_DD_VERSION
docker build \
  --platform linux/amd64 \
  --build-arg DD_VERSION="$SHORT_SHA" \
  -t "$IMAGE:latest" \
  -t "$IMAGE:$BUILD_TAG" \
  .

# Render placeholders in service.yaml
sed \
  -e "s|__APP_IMAGE__|$IMAGE:$BUILD_TAG|g" \
  -e "s|__SHORT_SHA__|$SHORT_SHA|g" \
  -e "s|__FULL_SHA__|$FULL_SHA|g" \
  -e "s|__GIT_REPO_URL__|$GIT_REPO_URL|g" \
  -e "s|__DD_ENV__|$DD_ENV|g" \
  service.yaml > "$TMP_YAML"

# Multi-container deploy requires 'services replace' (not 'gcloud run deploy')
gcloud run services replace "$TMP_YAML" --region "$REGION" --project "$PROJECT_ID"
```

## next.config.mjs

Required configuration for dd-trace compatibility with Next.js:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Prevent webpack from bundling dd-trace — required for runtime monkey-patching
  serverExternalPackages: ['dd-trace', '@google/genai'],
  // Enable browser-side source maps for Datadog RUM error mapping
  productionBrowserSourceMaps: true,
  env: {
    // Bake git SHA into client bundle (available at build time via --build-arg)
    NEXT_PUBLIC_DD_VERSION: process.env.DD_VERSION ?? '',
  },
};
export default nextConfig;
```

### Why `serverExternalPackages`?

dd-trace works by monkey-patching Node.js modules at runtime. If webpack bundles
dd-trace, the patches never apply. Adding it to `serverExternalPackages` tells
Next.js to leave it as a native require.

## Source Code Integration

Enable Datadog Source Code Integration with these env vars in service.yaml:

```yaml
- name: DD_GIT_COMMIT_SHA
  value: '__FULL_SHA__'
- name: DD_GIT_REPOSITORY_URL
  value: __GIT_REPO_URL__
```

Plus enable source maps in Dockerfile (`--enable-source-maps`) and
next.config.mjs (`productionBrowserSourceMaps: true`).

Ref: https://docs.datadoghq.com/source_code/service-mapping/?tab=nodejs
