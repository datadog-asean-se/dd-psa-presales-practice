/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Required for dd-trace auto-instrumentation in Next.js (App Router).
  // Prevents webpack from bundling these modules so dd-trace can patch them at runtime.
  // https://docs.datadoghq.com/llm_observability/instrumentation/auto_instrumentation?tab=nodejs#support-for-nextjs
  serverExternalPackages: ['dd-trace', '@google/genai'],
  // Generate browser-side source maps in production so that:
  // - Datadog RUM can map minified JS errors back to original TypeScript source
  // - Code Origin for Spans (when Next.js is supported) can resolve file/line
  // https://docs.datadoghq.com/tracing/code_origin/?tab=nodejs#compatibility-requirements
  productionBrowserSourceMaps: true,
  env: {
    // Bake the git short SHA into the client bundle so the UI can display the
    // build version. DD_VERSION is passed as --build-arg in deploy.sh so it is
    // available to next build at image build time (not just Cloud Run runtime).
    NEXT_PUBLIC_DD_VERSION: process.env.DD_VERSION ?? '',
    // RUM browser-safe tokens — baked into the client bundle at build time.
    // These are write-only tokens (cannot read data) so it is safe to expose them.
    NEXT_PUBLIC_DD_RUM_APP_ID: process.env.DD_RUM_APP_ID ?? '',
    NEXT_PUBLIC_DD_RUM_CLIENT_TOKEN: process.env.DD_RUM_CLIENT_TOKEN ?? '',
  },
};

export default nextConfig;
