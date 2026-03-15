import { describe, it, expect, vi } from 'vitest';

// ── Module-level mocks (hoisted before imports) ─────────────────────────────
vi.mock('dd-trace', () => ({
  default: {
    init: vi.fn().mockReturnThis(),
    llmobs: {
      annotationContext: vi.fn().mockImplementation(async (_ctx: unknown, fn: () => unknown) => fn()),
      trace: vi.fn().mockImplementation(async (_opts: unknown, fn: () => unknown) => fn()),
      annotate: vi.fn(),
    },
  },
}));

vi.mock('@google/genai', () => ({
  // Must use function (not arrow) so it can be called with `new`
  GoogleGenAI: vi.fn().mockImplementation(function () {
    return { models: { generateContentStream: vi.fn() } };
  }),
  ThinkingLevel: { HIGH: 'HIGH', LOW: 'LOW' },
}));

vi.mock('../../../lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { classifyGeminiError, isRetryableGeminiError } from '../geminiService';

// ── isRetryableGeminiError ───────────────────────────────────────────────────

describe('isRetryableGeminiError()', () => {
  it.each([
    ['503 service unavailable', true],
    ['model is overloaded', true],
    ['service unavailable', true],
    ['429 too many requests', true],
    ['rate limit exceeded', true],
    ['RESOURCE_EXHAUSTED quota', true],
  ])('returns true for: %s', (message, expected) => {
    expect(isRetryableGeminiError(new Error(message))).toBe(expected);
  });

  it.each([
    ['401 Unauthorized invalid API key', false],
    ['403 permission denied', false],
    ['404 model not found', false],
    ['500 internal server error', false],
    ['timeout deadline exceeded', false],
    ['response blocked by safety filters', false],
    ['network error', false],
  ])('returns false for: %s', (message, expected) => {
    expect(isRetryableGeminiError(new Error(message))).toBe(expected);
  });

  it('handles non-Error objects', () => {
    expect(isRetryableGeminiError('503 overloaded')).toBe(true);
    expect(isRetryableGeminiError({ message: '503' })).toBe(false); // toString gives [object Object]
    expect(isRetryableGeminiError(null)).toBe(false);
  });
});

// ── classifyGeminiError ──────────────────────────────────────────────────────

describe('classifyGeminiError()', () => {
  it('classifies API key / auth errors', () => {
    const cases = [
      new Error('API_KEY is invalid'),
      new Error('api key missing'),
      new Error('401 Unauthorized'),
    ];
    for (const err of cases) {
      expect(classifyGeminiError(err)).toMatch(/Authentication/i);
    }
  });

  it('classifies permission / 403 errors', () => {
    const cases = [
      new Error('403 Forbidden'),
      new Error('permission denied for this resource'),
    ];
    for (const err of cases) {
      expect(classifyGeminiError(err)).toMatch(/Access denied/i);
    }
  });

  it('classifies rate-limit / quota errors', () => {
    const cases = [
      new Error('429 too many requests'),
      new Error('quota exceeded'),
      new Error('rate limit hit'),
      new Error('RESOURCE_EXHAUSTED'),
    ];
    for (const err of cases) {
      expect(classifyGeminiError(err)).toMatch(/Rate limit/i);
    }
  });

  it('classifies model-not-found / 404 errors', () => {
    const cases = [
      new Error('404 model not found'),
      new Error('model does not exist'),
    ];
    for (const err of cases) {
      expect(classifyGeminiError(err)).toMatch(/Model not found/i);
    }
  });

  it('classifies 503 / overloaded errors', () => {
    const cases = [
      new Error('503 service unavailable'),
      new Error('model is overloaded please retry'),
    ];
    for (const err of cases) {
      expect(classifyGeminiError(err)).toMatch(/overloaded/i);
    }
  });

  it('classifies 500 / internal errors', () => {
    expect(classifyGeminiError(new Error('500 internal server error'))).toMatch(/internal error/i);
  });

  it('classifies timeout errors', () => {
    const cases = [
      new Error('request timeout'),
      new Error('deadline exceeded'),
    ];
    for (const err of cases) {
      expect(classifyGeminiError(err)).toMatch(/timed out/i);
    }
  });

  it('classifies safety / blocked errors', () => {
    const cases = [
      new Error('response blocked by safety filters'),
      new Error('content was blocked due to harm'),
    ];
    for (const err of cases) {
      expect(classifyGeminiError(err)).toMatch(/safety/i);
    }
  });

  it('falls back to a generic message for unknown errors', () => {
    const err = new Error('something completely unexpected');
    const result = classifyGeminiError(err);
    expect(result).toMatch(/Gemini API error/i);
    expect(result).toContain('something completely unexpected');
  });

  it('handles non-Error objects', () => {
    expect(classifyGeminiError('raw string error')).toContain('raw string error');
    expect(classifyGeminiError(null)).toBeDefined();
  });
});
