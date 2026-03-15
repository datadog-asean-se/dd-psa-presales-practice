import { NextRequest, NextResponse } from "next/server";
import { chatWithGeminiStream } from "../../../services/geminiService";
import { Message, EXERCISES, AI_MODELS, LANGUAGES } from "../../../types";
import logger from "../../../lib/logger";

const VALID_EXERCISE_IDS = new Set(EXERCISES.map((e) => e.id));
const VALID_MODEL_IDS = new Set(AI_MODELS.map((m) => m.id));
const VALID_LANGUAGE_NAMES = new Set(LANGUAGES.map((l) => l.name));
const MAX_MESSAGES = 200;
const MAX_TEAM_NAME_LEN = 80;
const MAX_SESSION_ID_LEN = 128;

export async function POST(req: NextRequest) {
  let exerciseId: string | undefined;
  let modelId: string | undefined;

  try {
    const body = await req.json();
    const {
      messages,
      language,
      isThinkingEnabled,
      teamName,
      sessionId,
      isDebrief,
    }: {
      messages: Message[];
      exerciseId?: string;
      language?: string;
      modelId?: string;
      isThinkingEnabled?: boolean;
      teamName?: string;
      sessionId?: string;
      isDebrief?: boolean;
    } = body;
    exerciseId = body.exerciseId;
    modelId = body.modelId;

    // ── Input validation ────────────────────────────────────────────────────────
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "messages must be a non-empty array" }, { status: 400 });
    }
    if (messages.length > MAX_MESSAGES) {
      return NextResponse.json({ error: `messages exceeds maximum of ${MAX_MESSAGES}` }, { status: 400 });
    }
    if (exerciseId !== undefined && !VALID_EXERCISE_IDS.has(exerciseId)) {
      return NextResponse.json({ error: "Invalid exerciseId" }, { status: 400 });
    }
    if (modelId !== undefined && !VALID_MODEL_IDS.has(modelId)) {
      return NextResponse.json({ error: "Invalid modelId" }, { status: 400 });
    }
    if (language !== undefined && !VALID_LANGUAGE_NAMES.has(language)) {
      return NextResponse.json({ error: "Invalid language" }, { status: 400 });
    }
    if (teamName !== undefined && teamName.length > MAX_TEAM_NAME_LEN) {
      return NextResponse.json({ error: `teamName exceeds maximum of ${MAX_TEAM_NAME_LEN} characters` }, { status: 400 });
    }
    if (sessionId !== undefined && sessionId.length > MAX_SESSION_ID_LEN) {
      return NextResponse.json({ error: `sessionId exceeds maximum of ${MAX_SESSION_ID_LEN} characters` }, { status: 400 });
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          await chatWithGeminiStream(
            messages,
            (chunk) => controller.enqueue(encoder.encode(chunk)),
            exerciseId,
            language,
            modelId,
            isThinkingEnabled ?? false,
            teamName,
            sessionId,
            isDebrief ?? false
          );
          controller.close();
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error("Gemini stream error in route handler", {
            exerciseId,
            modelId,
            error: errMsg,
          });
          // Encode the error as a null-prefixed sentinel chunk so the stream
          // closes cleanly. Using controller.error() here would cause an abrupt
          // connection drop that the nginx proxy returns as a 502 Bad Gateway.
          controller.enqueue(encoder.encode("\x00" + errMsg));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    logger.error("Chat route handler error", {
      exerciseId,
      modelId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
