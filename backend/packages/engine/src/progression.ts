import { round } from './round.js';
import { EngineError } from './errors.js';
import type { LogEntry, Prescribed, RevisionParams } from './types.js';

/**
 * Compute the prescribed weight for every occurrence from 0 through
 * `throughIndex` (inclusive).
 *
 * The walk has no "future" special case: a future occurrence simply has no log,
 * and the no-log branch already adds the increment — exactly the spec recurrence
 * where `done`, `missed`, and `future` share a case. Because every revision seeds
 * its own `startWeightLb`, revision boundaries never interact with failure logic.
 */
export function computeChain(
  revisions: RevisionParams[],
  logs: LogEntry[],
  throughIndex: number,
): Prescribed[] {
  if (revisions.length === 0) throw new EngineError('at least one revision is required');
  const revs = [...revisions].sort((a, b) => a.effectiveFromIndex - b.effectiveFromIndex);
  if (revs[0]!.effectiveFromIndex !== 0) {
    throw new EngineError('the first revision must take effect at index 0');
  }
  const logAt = new Map(logs.map((l) => [l.occurrenceIndex, l]));
  const revAt = (k: number): RevisionParams => revs.findLast((r) => r.effectiveFromIndex <= k)!;

  const out: Prescribed[] = [];
  let w = 0;

  for (let k = 0; k <= throughIndex; k++) {
    const rev = revAt(k);

    if (rev.effectiveFromIndex === k) {
      // A revision (including revision 0) takes effect here: it seeds the weight.
      w = round(rev.startWeightLb, rev.roundingStepLb);
    } else {
      const prevLog = logAt.get(k - 1);
      const prevRev = revAt(k - 1);
      if (prevLog?.status === 'failed') {
        w = round(prevLog.manualNextWeightLb ?? w * prevRev.failureMultiplier, prevRev.roundingStepLb);
      } else {
        // done, missing log (missed), or future: calendar marches on.
        w = round(w + prevRev.incrementLb, prevRev.roundingStepLb);
      }
    }

    // Sanity clamp: never prescribe zero or negative after a deep failure spiral.
    // Reflects the "no floor for MVP" decision; a real floor slots in here later.
    w = Math.max(w, rev.roundingStepLb);
    out.push({ occurrenceIndex: k, weightLb: w, sets: rev.sets, reps: rev.reps });
  }
  return out;
}

/** Prescribed weights for `count` occurrences starting at `fromIndex`. */
export function projectForward(
  revisions: RevisionParams[],
  logs: LogEntry[],
  fromIndex: number,
  count: number,
): Prescribed[] {
  if (count <= 0) return [];
  return computeChain(revisions, logs, fromIndex + count - 1).slice(fromIndex);
}
