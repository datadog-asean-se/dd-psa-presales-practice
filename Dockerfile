# ---- deps stage: install all node_modules ----
FROM node:22-slim AS deps
WORKDIR /app

# Build tools required for native modules (e.g. better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

# ---- builder stage: build the Next.js app ----
FROM node:22-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# DD_VERSION is the git short SHA passed via --build-arg in deploy.sh.
# It must be set here (build time) so next.config.mjs can bake it into
# the client bundle as NEXT_PUBLIC_DD_VERSION.
ARG DD_VERSION
ENV DD_VERSION=$DD_VERSION

# Ensure public dir exists (Next.js requires it for standalone copy)
RUN mkdir -p public

RUN npm run build

# ---- runner stage: minimal production image ----
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Required for Datadog serverless-init SSL on slim images
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy Datadog serverless-init entrypoint for APM tracing
COPY --from=datadog/serverless-init:1 /datadog-init /app/datadog-init

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

# Copy the standalone output (self-contained Next.js server + traced dependencies)
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# dd-trace is loaded via NODE_OPTIONS before Next.js starts and is not traced
# by the standalone bundler. Install it here so npm resolves all transitive deps
# (dc-polyfill, @datadog/pprof, native bindings, etc.) correctly.
RUN npm install --no-save dd-trace

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# dd-trace is initialised in-code via src/instrumentation.ts (Next.js lifecycle hook).
# NODE_OPTIONS --require dd-trace/init must NOT be set when using in-code init.

# --enable-source-maps tells Node.js to read *.js.map files alongside compiled JS,
# so stack traces (and Datadog Code Origin / Error Tracking) resolve back to the
# original TypeScript file + line number.
# https://docs.datadoghq.com/tracing/code_origin/?tab=nodejs#compatibility-requirements

# serverless-init wraps the app process and handles APM flushing on shutdown
ENTRYPOINT ["/app/datadog-init"]
CMD ["node", "--enable-source-maps", "server.js"]
