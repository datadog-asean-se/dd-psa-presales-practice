# Structured Logging with Winston + Datadog

## Setup

```typescript
// src/lib/logger.ts
import { createLogger, format, transports } from "winston";

const logger = createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  exitOnError: false,
  format: format.combine(
    format.timestamp(),
    format.json()
  ),
  transports: [new transports.Console()],
});

export default logger;
```

## Dependencies

```bash
npm install winston
```

## Datadog integration

Set these environment variables in `service.yaml`:

```yaml
- name: DD_LOGS_ENABLED
  value: 'true'
- name: DD_LOGS_INJECTION
  value: 'true'
- name: DD_SOURCE
  value: nodejs
```

- `DD_LOGS_ENABLED`: enables log collection by the Datadog Agent / serverless-init
- `DD_LOGS_INJECTION`: dd-trace automatically injects `dd.trace_id`, `dd.span_id`,
  `dd.service`, `dd.env`, `dd.version` into every log entry — linking logs to APM traces
- `DD_SOURCE`: sets the log source for Datadog log pipeline processing

## Usage pattern

```typescript
import logger from "../lib/logger";

logger.info("Gemini stream request", {
  exerciseId,
  modelId,
  messageCount: messages.length,
  teamName,
});

logger.error("Gemini stream error", {
  exerciseId,
  error: err instanceof Error ? err.message : String(err),
});
```

## JSON format

Winston's `format.json()` ensures each log entry is a single JSON object.
This is critical because:
- Datadog parses JSON logs automatically (no custom parsing rules needed)
- Multiline content stays in a single log event
- Structured fields are indexed and searchable in Datadog Log Explorer
