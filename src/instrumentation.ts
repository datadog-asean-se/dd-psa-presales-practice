/**
 * Next.js instrumentation hook — runs once at server start before any routes load.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * We use this to initialise dd-trace with LLM Observability via the in-code setup:
 * https://docs.datadoghq.com/llm_observability/instrumentation/sdk/?tab=nodejs#in-code-setup
 *
 * Important: do NOT combine this with NODE_OPTIONS="--require dd-trace/init".
 * In-code init and auto-init must not both run — this file is the single init point.
 */
export async function register() {
  // Only instrument on the Node.js runtime, not on the Edge runtime.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { default: tracer } = await import("dd-trace");

    tracer.init({
      llmobs: {
        // Groups all LLM spans under this ML app name in Datadog LLM Observability.
        mlApp: process.env.DD_LLMOBS_ML_APP ?? process.env.DD_SERVICE,
        // agentlessEnabled: true → dd-trace sends LLM data directly to Datadog's
        // intake using DD_API_KEY. APM traces/metrics still go through serverless-init.
        agentlessEnabled: true,
      },
    });
  }
}
