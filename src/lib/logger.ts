import { createLogger, format, transports } from "winston";

// JSON format keeps multiline content in a single log event in Datadog.
// DD_LOGS_INJECTION (set in service.yaml) automatically enriches every log
// with the active trace/span IDs so logs correlate with APM traces.
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
