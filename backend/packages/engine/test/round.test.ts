import { describe, expect, it } from 'vitest';
import { round } from '../src/round.js';
import { EngineError } from '../src/errors.js';

describe('round', () => {
  it('snaps to the nearest multiple of step', () => {
    expect(round(141, 5)).toBe(140);
    expect(round(143, 5)).toBe(145);
    expect(round(100, 2.5)).toBe(100);
    expect(round(101, 2.5)).toBe(100);
    expect(round(101.3, 2.5)).toBe(102.5);
  });

  it('breaks exact ties upward (half-up)', () => {
    expect(round(132.5, 5)).toBe(135);
    expect(round(2.5, 5)).toBe(5);
    expect(round(1.25, 2.5)).toBe(2.5);
  });

  it('rounds a sub-tie value down (0.9 * 145 = 130.5 -> 130)', () => {
    expect(round(130.5, 5)).toBe(130);
  });

  it('throws on a non-positive step', () => {
    expect(() => round(100, 0)).toThrow(EngineError);
    expect(() => round(100, -5)).toThrow(EngineError);
  });
});
