import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Module-level mocks ────────────────────────────────────────────────────────

vi.mock('../../../../services/geminiService', () => ({
  chatWithGeminiStream: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// dd-trace is pulled in transitively; mock it to avoid network/init side-effects
vi.mock('dd-trace', () => ({
  default: {
    init: vi.fn().mockReturnThis(),
    llmobs: {
      annotationContext: vi.fn(),
      trace: vi.fn(),
      annotate: vi.fn(),
    },
  },
}));

import { POST } from '../route';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validMessages = [{ role: 'user', text: 'Hello' }];

// ── Test suite ─────────────────────────────────────────────────────────────────

beforeEach(() => vi.clearAllMocks());

describe('POST /api/chat — input validation', () => {

  // ── messages ────────────────────────────────────────────────────────────────

  describe('messages', () => {
    it('returns 400 when messages is absent', async () => {
      const res = await POST(makeReq({}));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining('messages') });
    });

    it('returns 400 when messages is not an array', async () => {
      const res = await POST(makeReq({ messages: 'hello' }));
      expect(res.status).toBe(400);
    });

    it('returns 400 when messages is an empty array', async () => {
      const res = await POST(makeReq({ messages: [] }));
      expect(res.status).toBe(400);
    });

    it('returns 400 when messages exceeds 200 items', async () => {
      const messages = Array(201).fill({ role: 'user', text: 'x' });
      const res = await POST(makeReq({ messages }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining('messages') });
    });

    it('accepts messages array at exactly 200 items', async () => {
      const messages = Array(200).fill({ role: 'user', text: 'x' });
      const res = await POST(makeReq({ messages }));
      expect(res.status).toBe(200);
    });
  });

  // ── exerciseId ───────────────────────────────────────────────────────────────

  describe('exerciseId', () => {
    it.each(['objective1', 'objective2', 'techfit', 'valueselling'])(
      'accepts valid exerciseId "%s"',
      async (exerciseId) => {
        const res = await POST(makeReq({ messages: validMessages, exerciseId }));
        expect(res.status).toBe(200);
      }
    );

    it('returns 400 for an unknown exerciseId', async () => {
      const res = await POST(makeReq({ messages: validMessages, exerciseId: 'hacking' }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining('exerciseId') });
    });

    it('accepts a request without exerciseId (optional)', async () => {
      const res = await POST(makeReq({ messages: validMessages }));
      expect(res.status).toBe(200);
    });
  });

  // ── modelId ───────────────────────────────────────────────────────────────

  describe('modelId', () => {
    it.each(['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3.1-pro-preview', 'gemini-3-pro-preview'])(
      'accepts valid modelId "%s"',
      async (modelId) => {
        const res = await POST(makeReq({ messages: validMessages, modelId }));
        expect(res.status).toBe(200);
      }
    );

    it('returns 400 for an unrecognised modelId', async () => {
      const res = await POST(makeReq({ messages: validMessages, modelId: 'gpt-4o' }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining('modelId') });
    });

    it('accepts a request without modelId (optional)', async () => {
      const res = await POST(makeReq({ messages: validMessages }));
      expect(res.status).toBe(200);
    });
  });

  // ── language ─────────────────────────────────────────────────────────────────

  describe('language', () => {
    it.each(['English', 'Japanese', 'Korean', 'Thai', 'Spanish', 'Vietnamese', 'French', 'German', 'Chinese'])(
      'accepts valid language "%s"',
      async (language) => {
        const res = await POST(makeReq({ messages: validMessages, language }));
        expect(res.status).toBe(200);
      }
    );

    it('returns 400 for an unsupported language', async () => {
      const res = await POST(makeReq({ messages: validMessages, language: 'Klingon' }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining('language') });
    });
  });

  // ── teamName ──────────────────────────────────────────────────────────────────

  describe('teamName', () => {
    it('accepts teamName within 80 characters', async () => {
      const res = await POST(makeReq({ messages: validMessages, teamName: 'Team Alpha' }));
      expect(res.status).toBe(200);
    });

    it('accepts teamName at exactly 80 characters', async () => {
      const res = await POST(makeReq({ messages: validMessages, teamName: 'a'.repeat(80) }));
      expect(res.status).toBe(200);
    });

    it('returns 400 when teamName exceeds 80 characters', async () => {
      const res = await POST(makeReq({ messages: validMessages, teamName: 'a'.repeat(81) }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining('teamName') });
    });
  });

  // ── sessionId ────────────────────────────────────────────────────────────────

  describe('sessionId', () => {
    it('accepts sessionId within 128 characters', async () => {
      const res = await POST(makeReq({ messages: validMessages, sessionId: 'abc-123' }));
      expect(res.status).toBe(200);
    });

    it('accepts sessionId at exactly 128 characters', async () => {
      const res = await POST(makeReq({ messages: validMessages, sessionId: 'a'.repeat(128) }));
      expect(res.status).toBe(200);
    });

    it('returns 400 when sessionId exceeds 128 characters', async () => {
      const res = await POST(makeReq({ messages: validMessages, sessionId: 'a'.repeat(129) }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining('sessionId') });
    });
  });

  // ── happy path ───────────────────────────────────────────────────────────────

  describe('valid requests', () => {
    it('returns a 200 streaming response for a minimal valid body', async () => {
      const res = await POST(makeReq({ messages: validMessages }));
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/plain');
    });

    it('returns a 200 streaming response with all valid optional fields', async () => {
      const res = await POST(makeReq({
        messages: validMessages,
        exerciseId: 'techfit',
        modelId: 'gemini-2.5-flash',
        language: 'Japanese',
        isThinkingEnabled: false,
        teamName: 'Team Ninja',
        sessionId: 'rum-session-xyz',
        isDebrief: false,
      }));
      expect(res.status).toBe(200);
    });

    it('invokes chatWithGeminiStream with the correct arguments', async () => {
      const { chatWithGeminiStream } = await import('../../../../services/geminiService');

      await POST(makeReq({
        messages: validMessages,
        exerciseId: 'valueselling',
        language: 'English',
        modelId: 'gemini-2.5-pro',
        isThinkingEnabled: true,
        teamName: 'Team Rocket',
        sessionId: 'ses-001',
        isDebrief: true,
      }));

      expect(chatWithGeminiStream).toHaveBeenCalledOnce();
      const [msgs, , exerciseId, language, modelId, isThinkingEnabled, teamName, sessionId, isDebrief] =
        (chatWithGeminiStream as ReturnType<typeof vi.fn>).mock.calls[0];

      expect(msgs).toEqual(validMessages);
      expect(exerciseId).toBe('valueselling');
      expect(language).toBe('English');
      expect(modelId).toBe('gemini-2.5-pro');
      expect(isThinkingEnabled).toBe(true);
      expect(teamName).toBe('Team Rocket');
      expect(sessionId).toBe('ses-001');
      expect(isDebrief).toBe(true);
    });
  });
});
