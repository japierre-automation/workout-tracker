import { describe, expect, it } from 'vitest';
import { computeChain, projectForward } from '../src/progression.js';
import { validateParams } from '../src/validate.js';
import type { LogEntry, RevisionParams } from '../src/types.js';

// Spec §4.2 Bench Press: start 135, increment 5, multiplier 0.9, step 5.
const bench: RevisionParams = {
  effectiveFromIndex: 0,
  startWeightLb: 135,
  incrementLb: 5,
  failureMultiplier: 0.9,
  roundingStepLb: 5,
  sets: 3,
  reps: 5,
};

const weights = (revs: RevisionParams[], logs: LogEntry[], through: number): number[] =>
  computeChain(revs, logs, through).map((p) => p.weightLb);

describe('computeChain — spec §4.2', () => {
  it('reproduces the prescribed sequence including the missed week 5', () => {
    // done@0, done@1, failed@2, done@3, (idx4 missed — no log), idx5 derived
    const logs: LogEntry[] = [
      { occurrenceIndex: 0, status: 'done' },
      { occurrenceIndex: 1, status: 'done' },
      { occurrenceIndex: 2, status: 'failed' },
      { occurrenceIndex: 3, status: 'done' },
    ];
    expect(weights([bench], logs, 5)).toEqual([135, 140, 145, 130, 135, 140]);
  });

  it('honours a manual override on the failed occurrence', () => {
    const logs: LogEntry[] = [
      { occurrenceIndex: 0, status: 'done' },
      { occurrenceIndex: 1, status: 'done' },
      { occurrenceIndex: 2, status: 'failed', manualNextWeightLb: 140 },
      { occurrenceIndex: 3, status: 'done' },
    ];
    // ..., 145, 140 (manual), 145, ...
    expect(weights([bench], logs, 5)).toEqual([135, 140, 145, 140, 145, 150]);
  });

  it('carries the increment through missed and future occurrences identically', () => {
    // No logs at all: every step is the no-log branch.
    expect(weights([bench], [], 4)).toEqual([135, 140, 145, 150, 155]);
  });

  it('applies the failure multiplier on occurrence 0', () => {
    const logs: LogEntry[] = [{ occurrenceIndex: 0, status: 'failed' }];
    // 135 -> 135*0.9 = 121.5 -> round step 5 -> 120
    expect(weights([bench], logs, 1)).toEqual([135, 120]);
  });

  it('lets a mid-chain revision reseed the weight regardless of history', () => {
    const rev2: RevisionParams = { ...bench, effectiveFromIndex: 3, startWeightLb: 200 };
    const logs: LogEntry[] = [
      { occurrenceIndex: 0, status: 'done' },
      { occurrenceIndex: 1, status: 'failed' },
    ];
    // idx0=135, idx1 (done@0)=140, idx2 (failed@1)=round(140*0.9)=126->125, idx3 reseed=200, idx4=205
    expect(weights([bench, rev2], logs, 4)).toEqual([135, 140, 125, 200, 205]);
  });

  it('clamps so a failure spiral never reaches zero', () => {
    const tiny: RevisionParams = { ...bench, startWeightLb: 5, roundingStepLb: 5 };
    const logs: LogEntry[] = [
      { occurrenceIndex: 0, status: 'failed' },
      { occurrenceIndex: 1, status: 'failed' },
      { occurrenceIndex: 2, status: 'failed' },
    ];
    for (const w of weights([tiny], logs, 3)) expect(w).toBeGreaterThanOrEqual(5);
  });

  it('throws when no revision seeds index 0', () => {
    const late: RevisionParams = { ...bench, effectiveFromIndex: 2 };
    expect(() => computeChain([late], [], 3)).toThrow();
    expect(() => computeChain([], [], 3)).toThrow();
  });
});

describe('projectForward', () => {
  it('agrees with computeChain on the overlapping range', () => {
    const logs: LogEntry[] = [
      { occurrenceIndex: 0, status: 'done' },
      { occurrenceIndex: 1, status: 'failed' },
    ];
    const full = computeChain([bench], logs, 9);
    expect(projectForward([bench], logs, 4, 6)).toEqual(full.slice(4));
  });

  it('returns nothing for a non-positive count', () => {
    expect(projectForward([bench], [], 3, 0)).toEqual([]);
  });
});

describe('drift guard (property)', () => {
  it('with increment a multiple of step and no failures, W(k) = W(0) + k*I', () => {
    const cases: Array<[number, number, number]> = [
      [100, 5, 5],
      [60, 2.5, 2.5],
      [135, 5, 10],
      [40, 1, 2],
    ];
    for (const [start, step, inc] of cases) {
      const rev: RevisionParams = { ...bench, startWeightLb: start, roundingStepLb: step, incrementLb: inc };
      const chain = computeChain([rev], [], 500);
      for (let k = 0; k <= 500; k++) {
        expect(chain[k]!.weightLb).toBe(Number((start + k * inc).toFixed(3)));
      }
    }
  });
});

describe('validateParams', () => {
  it('flags an increment that is not a multiple of the rounding step', () => {
    const codes = validateParams({ ...bench, incrementLb: 2, roundingStepLb: 5 }).map((w) => w.code);
    expect(codes).toContain('increment_not_multiple_of_step');
  });

  it('flags an out-of-range failure multiplier and a zero increment', () => {
    expect(validateParams({ ...bench, failureMultiplier: 1.2 }).map((w) => w.code)).toContain(
      'failure_multiplier_out_of_range',
    );
    expect(validateParams({ ...bench, incrementLb: 0 }).map((w) => w.code)).toContain('zero_increment');
  });

  it('returns no warnings for clean parameters', () => {
    expect(validateParams(bench)).toEqual([]);
  });
});
