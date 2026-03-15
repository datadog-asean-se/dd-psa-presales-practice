import { Message } from "../types";

/**
 * Calls the /api/chat route and streams response chunks back via onChunk.
 * A null-prefixed (\x00) chunk is the server-side error sentinel — it is
 * converted into a thrown Error so callers can handle it uniformly.
 */
export async function streamGeminiChat(
  messages: Message[],
  onChunk: (chunk: string) => void,
  exerciseId?: string,
  language?: string,
  modelId?: string,
  isThinkingEnabled?: boolean,
  teamName?: string,
  sessionId?: string,
  isDebrief?: boolean
) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      exerciseId,
      language,
      modelId,
      isThinkingEnabled,
      teamName,
      sessionId,
      isDebrief,
    }),
  });

  if (!response.ok) throw new Error(`Chat API error: ${response.status}`);

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (text.startsWith("\x00")) throw new Error(text.slice(1));
    onChunk(text);
  }
}
