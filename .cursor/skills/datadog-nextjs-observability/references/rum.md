# Datadog RUM for Next.js + APM/LLMObs Correlation

## Table of Contents

- [Installation](#installation)
- [RUM initialization](#rum-initialization)
- [APM-RUM correlation](#apm-rum-correlation)
- [User identification](#user-identification)
- [Global context properties](#global-context-properties)
- [RUM-LLMObs correlation](#rum-llmobs-correlation)
- [Build version display](#build-version-display)

## Installation

```bash
npm install @datadog/browser-rum
```

## RUM initialization

Initialize in a `"use client"` component, typically the root page, inside
a `useEffect` that runs once on mount:

```typescript
"use client";
import { datadogRum } from '@datadog/browser-rum';
import { useEffect } from 'react';

useEffect(() => {
  datadogRum.init({
    applicationId: '<APPLICATION_ID>',
    clientToken: '<CLIENT_TOKEN>',
    site: 'datadoghq.com',
    service: 'my-service-name',
    env: 'prod',
    sessionSampleRate: 100,
    sessionReplaySampleRate: 100,
    trackBfcacheViews: true,
    trackResources: true,
    trackLongTasks: true,
    trackUserInteractions: true,
    defaultPrivacyLevel: 'allow',
    // APM-RUM correlation: inject trace-context headers into API requests
    allowedTracingUrls: [
      (url: string) => url.startsWith(`${window.location.origin}/api/`),
    ],
  });
}, []);
```

### Configuration notes

- `applicationId` and `clientToken`: from Datadog RUM application setup
- `service` should match `DD_SERVICE` in the backend for correlation
- `sessionSampleRate: 100` captures all sessions (adjust for production)
- `defaultPrivacyLevel: 'allow'` enables session replay text capture

## APM-RUM correlation

`allowedTracingUrls` tells the RUM SDK to inject Datadog/W3C trace-context
headers into matching requests. This links frontend resources to backend
APM traces in the Datadog UI.

```typescript
allowedTracingUrls: [
  (url: string) => url.startsWith(`${window.location.origin}/api/`),
],
```

This matches all same-origin `/api/*` requests (Next.js API routes).

Ref: https://docs.datadoghq.com/tracing/other_telemetry/rum?tab=browserrum#setup-rum

## User identification

Set the RUM user to enable session filtering by user in RUM Explorer:

```typescript
useEffect(() => {
  if (teamName) {
    datadogRum.setUser({
      id: teamName,
      name: teamName,
    });
  }
}, [teamName]);
```

The `id` field becomes queryable as `usr.id` in RUM Explorer.

Ref: https://docs.datadoghq.com/real_user_monitoring/application_monitoring/browser/advanced_configuration/#user-session

## Global context properties

Add custom properties to all RUM events for filtering:

```typescript
datadogRum.setGlobalContextProperty('team_name', teamName);
```

## RUM-LLMObs correlation

To link RUM sessions with LLM Observability spans:

1. **Client side**: get the RUM session ID:
```typescript
const getRumSessionId = (): string | undefined =>
  datadogRum.getInternalContext()?.session_id ?? undefined;
```

2. **Pass to backend**: include `sessionId` in the API request body:
```typescript
await fetch('/api/chat', {
  method: 'POST',
  body: JSON.stringify({
    messages,
    sessionId: getRumSessionId(),
    // ...other fields
  }),
});
```

3. **Backend**: use `sessionId` in `llmobs.trace()`:
```typescript
await llmobs.trace(
  {
    kind: "llm",
    name: "my-llm-call",
    sessionId: sessionId,  // links this span to the RUM session
  },
  async () => { /* ... */ }
);
```

Ref: https://docs.datadoghq.com/real_user_monitoring/correlate_with_other_telemetry/llm_observability/

## Build version display

Expose the build version (git SHA) to the client:

1. **next.config.mjs**: bake into client bundle at build time
```javascript
env: {
  NEXT_PUBLIC_DD_VERSION: process.env.DD_VERSION ?? '',
},
```

2. **Dockerfile**: pass as build-arg before `npm run build`
```dockerfile
ARG DD_VERSION
ENV DD_VERSION=$DD_VERSION
```

3. **deploy.sh**: supply the arg during build
```bash
docker build --build-arg DD_VERSION="$SHORT_SHA" ...
```

4. **Client component**: read the baked-in value
```tsx
{process.env.NEXT_PUBLIC_DD_VERSION
  ? `v${process.env.NEXT_PUBLIC_DD_VERSION}`
  : 'v1.0'}
```
