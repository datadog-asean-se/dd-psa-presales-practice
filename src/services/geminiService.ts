import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { Message, EXERCISES, AI_MODELS } from "../types";
import {
  CUSTOMER_PROFILE,
  OBJECTIVE_1_REFERENCE,
  OBJECTIVE_2_REFERENCE,
  TECH_FIT_REFERENCE,
  VALUE_SELLING_REFERENCE,
} from "../constants/knowledge";
import logger from "../lib/logger";
import { llmobs } from "../lib/llmobs";

// Module-level singleton — avoids re-constructing the SDK client on every request.
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const BASE_SYSTEM_INSTRUCTION = `
You are an interactive Datadog presales practice coach. Your role is to simulate realistic customer interactions or act as a coaching agent so DPN presales engineers can sharpen their skills.

# CRITICAL BEHAVIOR RULES
1. NEVER reveal answers, strategies, or discussion points upfront. The user must discover them through practice.
2. If the exercise is a "Meeting Room Simulation", stay in character as the customer personas throughout the exercise. Break character only for brief coaching nudges if the user is completely stuck.
3. If the exercise is a "Coaching Quiz", act as the AI Coaching Agent. Ask open-ended questions, analyze the user's responses, provide constructive feedback, and **always ask targeted follow-up questions based on their initial responses to prompt deeper reflection.**
4. Challenge the user's thinking. Ask "Why do you think that?", "What makes you say that?", or "How would you uncover that in a real conversation?" to deepen learning.
5. Simulate realistic resistance in meeting simulations. Customers push back, go on tangents, and have competing priorities.
6. Guide without giving away. If the user is stuck, give a subtle hint.
7. Track progress silently. Mentally note which key areas the user has covered and which they've missed.
8. Provide a debrief ONLY when the exercise ends. Summarize what they covered well, what they missed, and specific improvement suggestions.

# RESPONSE FORMAT
- When acting as a persona in a meeting, start your message with "[Persona Name]: ".
- When acting as the AI Coaching Agent, start your message with "[AI Coach]: ".
- Use Markdown for formatting.
- If you are providing a debrief, use the structured format:
## Exercise Debrief
### What You Did Well
...
### Areas to Improve
...
### Key Areas Covered: X/Y
...
### Coaching Tips
...
### Suggested Follow-Up
...
`;

function getExerciseReference(exerciseId?: string) {
  switch (exerciseId) {
    case "objective1":
      return OBJECTIVE_1_REFERENCE;
    case "objective2":
      return OBJECTIVE_2_REFERENCE;
    case "techfit":
      return TECH_FIT_REFERENCE;
    case "valueselling":
      return VALUE_SELLING_REFERENCE;
    default:
      return "";
  }
}

// Prompt template for Datadog LLM Observability Prompt Tracking.
// Uses {{placeholder}} syntax for dynamic parts; the static BASE_SYSTEM_INSTRUCTION
// is inlined so that automatic version hashing detects any prompt changes.
// https://docs.datadoghq.com/llm_observability/instrumentation/sdk/?tab=nodejs#prompt-tracking
const SYSTEM_PROMPT_TEMPLATE = `${BASE_SYSTEM_INSTRUCTION}
CUSTOMER PROFILE (INTERNAL ONLY):
{{customer_profile}}

{{exercise_context}}

IMPORTANT: Conduct the entire conversation in {{language}}. All persona responses and debriefs must be in {{language}}.`;

// ---------------------------------------------------------------------------
// Retry helpers
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Returns true for transient Gemini errors that are safe to retry. */
export function isRetryableGeminiError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return (
    lower.includes("503") ||
    lower.includes("overloaded") ||
    lower.includes("unavailable") ||
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("resource_exhausted")
  );
}

export function classifyGeminiError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes("api_key") || lower.includes("api key") || lower.includes("401") || lower.includes("unauthorized")) {
    return "Authentication failed. Please check the Gemini API key configuration.";
  }
  if (lower.includes("403") || lower.includes("permission") || lower.includes("forbidden")) {
    return "Access denied. The API key does not have permission to use this model.";
  }
  if (lower.includes("429") || lower.includes("quota") || lower.includes("rate limit") || lower.includes("resource_exhausted")) {
    return "Rate limit exceeded. Please wait a moment and try again.";
  }
  // Check 503/overloaded before the generic "model" check so that messages like
  // "model is overloaded" are classified as transient errors, not model-not-found.
  if (lower.includes("503") || lower.includes("unavailable") || lower.includes("overloaded")) {
    return "The Gemini service is temporarily overloaded. Please try again in a few seconds.";
  }
  if (lower.includes("404") || lower.includes("not found") || lower.includes("model")) {
    return `Model not found or unavailable. Try switching to a different model.`;
  }
  if (lower.includes("500") || lower.includes("internal")) {
    return "The Gemini service returned an internal error. Please try again.";
  }
  if (lower.includes("timeout") || lower.includes("deadline")) {
    return "The request timed out. Please try again or switch to a faster model.";
  }
  if (lower.includes("safety") || lower.includes("blocked") || lower.includes("harm")) {
    return "The response was blocked by Gemini's safety filters. Please rephrase your message.";
  }
  return `Gemini API error: ${msg}`;
}

export async function chatWithGeminiStream(
  messages: Message[],
  onChunk: (chunk: string) => void,
  exerciseId?: string,
  language: string = "English",
  modelId: string = "gemini-2.5-pro",
  isThinkingEnabled: boolean = false,
  teamName?: string,
  sessionId?: string,
  isDebrief: boolean = false
) {
  const reference = getExerciseReference(exerciseId);
  const exerciseContext = exerciseId
    ? `Current Exercise: ${exerciseId}.\n\nREFERENCE DATA (INTERNAL ONLY):\n${reference}`
    : "Wait for the user to select an exercise.";

  // Human-readable exercise title used as the practice_name LLMObs tag so spans
  // can be filtered/grouped by practice in the LLM Observability Explorer.
  const practiceName =
    EXERCISES.find((e) => e.id === exerciseId)?.title ?? exerciseId ?? "unknown";

  // Derive the actual system instruction by substituting SYSTEM_PROMPT_TEMPLATE
  // placeholders. This keeps the LLMObs prompt template and the live instruction
  // in sync — a single source of truth.
  const systemInstruction = SYSTEM_PROMPT_TEMPLATE
    .replace("{{customer_profile}}", CUSTOMER_PROFILE)
    .replace("{{exercise_context}}", exerciseContext)
    .replaceAll("{{language}}", language);

  const history = messages.map((m) => ({
    role: m.role === "system" ? "user" : m.role,
    parts: [{ text: m.text }],
  }));

  // Look up supportsThinking from the AI_MODELS registry rather than relying
  // on a fragile model-name prefix check.
  const modelDef = AI_MODELS.find((m) => m.id === modelId);
  const config: Record<string, unknown> = {
    systemInstruction,
    temperature: 0.7,
  };

  if (modelDef?.supportsThinking) {
    config.thinkingConfig = {
      thinkingLevel: isThinkingEnabled ? ThinkingLevel.HIGH : ThinkingLevel.LOW,
    };
  }

  logger.info("Gemini stream request", {
    exerciseId,
    language,
    modelId,
    isThinkingEnabled,
    messageCount: messages.length,
    teamName,
    isDebrief,
  });

  // When this is an end-of-exercise debrief, capture chunks so the outer task
  // span can be annotated with the full debrief text as output.
  let capturedDebriefResponse = "";
  const activeOnChunk = isDebrief
    ? (chunk: string) => {
        capturedDebriefResponse += chunk;
        onChunk(chunk);
      }
    : onChunk;

  // Inner function: prompt-tracked LLM span (shared by both regular and debrief paths).
  // https://docs.datadoghq.com/llm_observability/instrumentation/sdk/?tab=nodejs#prompt-tracking
  const runLLMSpan = async () => {
    await llmobs.annotationContext(
      {
        prompt: {
          id: "presales-practice-coach",
          template: SYSTEM_PROMPT_TEMPLATE,
          variables: {
            customer_profile: CUSTOMER_PROFILE,
            exercise_context: exerciseContext,
            language,
          },
        },
      },
      async () => {
        // sessionId links this LLM span to the RUM session for APM/RUM/LLMObs correlation.
        // https://docs.datadoghq.com/real_user_monitoring/correlate_with_other_telemetry/llm_observability/
        await llmobs.trace(
          {
            kind: "llm",
            name: isDebrief ? "exercise.debrief" : "gemini.generateContent",
            modelName: modelId,
            modelProvider: "google",
            ...(sessionId ? { sessionId } : {}),
          },
          async () => {
            // Annotate input messages and enrich with team name tag for span filtering.
            // https://docs.datadoghq.com/llm_observability/instrumentation/sdk/?tab=nodejs#enriching-spans
            llmobs.annotate({
              inputData: messages.map((m) => ({
                role: m.role === "model" ? "assistant" : m.role,
                content: m.text,
              })),
              metadata: {
                exerciseId,
                language,
                temperature: 0.7,
                isThinkingEnabled,
              },
              tags: {
                ...(teamName ? { team_name: teamName } : {}),
                ...(practiceName ? { practice_name: practiceName } : {}),
              },
            });

            let fullResponse = "";

            // Retry loop — only retries if no chunks have been streamed yet
            // (safe to restart; if partial output was already sent we cannot undo it).
            let attempt = 0;
            while (true) {
              let chunksReceived = 0;
              try {
                const stream = await ai.models.generateContentStream({
                  model: modelId,
                  contents: history,
                  config,
                });

                for await (const chunk of stream) {
                  if (chunk.text) {
                    activeOnChunk(chunk.text);
                    fullResponse += chunk.text;
                    chunksReceived++;
                  }
                }

                // Stream completed successfully — exit retry loop.
                break;
              } catch (err) {
                const canRetry =
                  chunksReceived === 0 &&
                  attempt < MAX_RETRIES &&
                  isRetryableGeminiError(err);

                if (canRetry) {
                  // Exponential backoff with jitter: 1.5s, 3s, 6s ± up to 1s
                  const delay =
                    BASE_RETRY_DELAY_MS * Math.pow(2, attempt) +
                    Math.random() * 1000;
                  logger.warn("Gemini retryable error — retrying", {
                    exerciseId,
                    modelId,
                    attempt: attempt + 1,
                    maxRetries: MAX_RETRIES,
                    delayMs: Math.round(delay),
                    error: err instanceof Error ? err.message : String(err),
                  });
                  attempt++;
                  await sleep(delay);
                  continue;
                }

                const friendlyMessage = classifyGeminiError(err);
                logger.error("Gemini stream error", {
                  exerciseId,
                  modelId,
                  attempt,
                  error: err instanceof Error ? err.message : String(err),
                  friendlyMessage,
                });
                throw new Error(friendlyMessage);
              }
            }

            llmobs.annotate({
              outputData: [{ role: "assistant", content: fullResponse }],
            });

            logger.info("Gemini stream completed", {
              exerciseId,
              modelId,
              isDebrief,
              attempts: attempt + 1,
            });
          }
        );
      }
    );
  };

  if (isDebrief) {
    // Wrap the LLM call in an outer Task span so the full debrief can be targeted
    // by Datadog Evaluations (quality, safety, etc.) independently of regular turns.
    // https://docs.datadoghq.com/llm_observability/instrumentation/sdk/?tab=nodejs#span-kinds
    await llmobs.trace(
      {
        kind: "task",
        name: "exercise.debrief",
        ...(sessionId ? { sessionId } : {}),
      },
      async () => {
        // Annotate the task span with the full conversation so evaluators have
        // complete context when scoring the debrief quality.
        llmobs.annotate({
          inputData: messages.map((m) => ({
            role: m.role === "model" ? "assistant" : m.role,
            content: m.text,
          })),
          metadata: { exerciseId, language },
          tags: {
            ...(exerciseId ? { exercise_id: exerciseId } : {}),
            ...(teamName ? { team_name: teamName } : {}),
            ...(practiceName ? { practice_name: practiceName } : {}),
          },
        });

        await runLLMSpan();

        // After the stream completes, annotate the task span output with the
        // full debrief text so evaluations can score it directly.
        llmobs.annotate({
          outputData: capturedDebriefResponse,
        });
      }
    );
  } else {
    await runLLMSpan();
  }
}
