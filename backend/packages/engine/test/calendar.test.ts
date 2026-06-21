import { describe, expect, it } from 'vitest';
import {
  dateForOccurrence,
  firstOccurrence,
  lastElapsedIndex,
  occurrenceIndexFor,
} from '../src/calendar.js';

// 2026-01-05 is a Monday (weekday 0 in our ISO 0=Mon convention).
const MON = '2026-01-05';

describe('firstOccurrence', () => {
  it('returns the start date when it already falls on the weekday', () => {
    expect(firstOccurrence(MON, 0)).toBe('2026-01-05');
  });

  it('advances to the next matching weekday', () => {
    expect(firstOccurrence('2026-01-06', 0)).toBe('2026-01-12'); // Tue -> next Mon
    expect(firstOccurrence('2026-01-01', 0)).toBe('2026-01-05'); // Thu -> next Mon
  });
});

describe('dateForOccurrence', () => {
  it('adds 7 days per occurrence', () => {
    expect(dateForOccurrence(MON, 0, 0)).toBe('2026-01-05');
    expect(dateForOccurrence(MON, 0, 1)).toBe('2026-01-12');
    expect(dateForOccurrence(MON, 0, 3)).toBe('2026-01-26');
  });
});

describe('occurrenceIndexFor', () => {
  it('is the inverse of dateForOccurrence', () => {
    for (let k = 0; k < 60; k++) {
      const d = dateForOccurrence(MON, 0, k);
      expect(occurrenceIndexFor(MON, 0, d)).toBe(k);
    }
  });

  it('returns null off-weekday or before the first occurrence', () => {
    expect(occurrenceIndexFor(MON, 0, '2026-01-06')).toBeNull(); // Tuesday
    expect(occurrenceIndexFor('2026-01-12', 0, '2026-01-05')).toBeNull(); // before start
  });
});

describe('lastElapsedIndex', () => {
  it('returns the highest elapsed index, or -1 before the first', () => {
    expect(lastElapsedIndex(MON, 0, '2026-01-04')).toBe(-1);
    expect(lastElapsedIndex(MON, 0, '2026-01-05')).toBe(0);
    expect(lastElapsedIndex(MON, 0, '2026-01-11')).toBe(0); // Sunday before next Mon
    expect(lastElapsedIndex(MON, 0, '2026-01-20')).toBe(2); // Tue after idx2 (01-19)
  });
});
