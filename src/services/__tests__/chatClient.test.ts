import { describe, it, expect, vi, beforeEach } from 'vitest';
import { streamGeminiChat } from '../chatClient';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Builds a ReadableStream that emits each string in `chunks` sequentially. */
function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

/** Builds a mock `fetch` that returns an ok streaming response. */
function mockFetch(chunks: string[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    body: makeStream(chunks).getReader(),
    // Provide a proper getReader so the while-loop in chatClient works
  } as unknown as Response);
}

/** Re-implement the mock so that response.body!.getReader() returns a real reader. */
function mockFetchWithReader(chunks: string[]) {
  const stream = makeStream(chunks);
  return vi.fn().mockResolvedValue({
    ok: true,
    body: stream,
  } as unknown as Response);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('streamGeminiChat()', () => {
  const messages = [{ role: 'user' as const, text: 'hello' }];

  it('calls /api/chat via POST with the correct body', async () => {
    const fetchMock = mockFetchWithReader(['hi']);
    vi.stubGlobal('fetch', fetchMock);

    const chunks: string[] = [];
    await streamGeminiChat(messages, (c) => chunks.push(c), 'objective1', 'English', 'gemini-2.5-pro');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/chat');
    expect(opts.method).toBe('POST');

    const body = JSON.parse(opts.body);
    expect(body.messages).toEqual(messages);
    expect(body.exerciseId).toBe('objective1');
    expect(body.language).toBe('English');
    expect(body.modelId).toBe('gemini-2.5-pro');
  });

  it('passes each received chunk to the onChunk callback', async () => {
    vi.stubGlobal('fetch', mockFetchWithReader(['Hello', ', ', 'world!']));

    const chunks: string[] = [];
    await streamGeminiChat(messages, (c) => chunks.push(c));

    expect(chunks).toEqual(['Hello', ', ', 'world!']);
  });

  it('throws when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      body: makeStream([]),
    } as unknown as Response));

    await expect(streamGeminiChat(messages, vi.fn())).rejects.toThrow('Chat API error: 500');
  });

  it('converts a null-byte sentinel chunk into a thrown Error', async () => {
    vi.stubGlobal('fetch', mockFetchWithReader(['\x00Rate limit exceeded. Please wait.']));

    await expect(streamGeminiChat(messages, vi.fn())).rejects.toThrow(
      'Rate limit exceeded. Please wait.'
    );
  });

  it('does not invoke onChunk for a sentinel chunk', async () => {
    vi.stubGlobal('fetch', mockFetchWithReader(['\x00Some error']));

    const onChunk = vi.fn();
    await expect(streamGeminiChat(messages, onChunk)).rejects.toThrow();
    expect(onChunk).not.toHaveBeenCalled();
  });

  it('includes optional parameters in the request body when provided', async () => {
    const fetchMock = mockFetchWithReader([]);
    vi.stubGlobal('fetch', fetchMock);

    await streamGeminiChat(
      messages,
      vi.fn(),
      'techfit',
      'Japanese',
      'gemini-2.5-flash',
      true,
      'Team Alpha',
      'session-abc',
      true
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.exerciseId).toBe('techfit');
    expect(body.language).toBe('Japanese');
    expect(body.modelId).toBe('gemini-2.5-flash');
    expect(body.isThinkingEnabled).toBe(true);
    expect(body.teamName).toBe('Team Alpha');
    expect(body.sessionId).toBe('session-abc');
    expect(body.isDebrief).toBe(true);
  });
});
