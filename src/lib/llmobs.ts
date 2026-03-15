/**
 * Re-exports the llmobs instance from the already-initialised dd-trace singleton.
 * instrumentation.ts calls tracer.init({ llmobs: {...} }) before any route handler
 * runs, so tracer.llmobs is always ready by the time this is imported in a request.
 */
import tracer from "dd-trace";

export const llmobs = tracer.llmobs;
