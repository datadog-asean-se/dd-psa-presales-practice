import { describe, it, expect } from 'vitest';
import { cn } from '../utils';

describe('cn()', () => {
  it('returns a single class unchanged', () => {
    expect(cn('foo')).toBe('foo');
  });

  it('joins multiple classes', () => {
    expect(cn('foo', 'bar', 'baz')).toBe('foo bar baz');
  });

  it('ignores falsy values', () => {
    expect(cn('foo', false, undefined, null, '', 'bar')).toBe('foo bar');
  });

  it('evaluates conditional objects', () => {
    expect(cn({ foo: true, bar: false, baz: true })).toBe('foo baz');
  });

  it('deduplicates via tailwind-merge (later class wins for same property)', () => {
    // tailwind-merge resolves conflicting Tailwind classes — last one wins
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('handles arrays', () => {
    expect(cn(['foo', 'bar'])).toBe('foo bar');
  });

  it('handles a mix of all input types', () => {
    expect(cn('base', { active: true, disabled: false }, ['extra'])).toBe('base active extra');
  });

  it('returns empty string for all-falsy inputs', () => {
    expect(cn(false, undefined, null)).toBe('');
  });
});
