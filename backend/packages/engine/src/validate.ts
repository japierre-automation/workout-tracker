import type { RevisionParams, Warning } from './types.js';

/**
 * Non-blocking sanity checks on a revision's parameters. Returns warnings the
 * client can surface as toasts; never throws, so a save is never blocked.
 *
 * `failedWeightLb` (the weight that was just failed) lets us flag a manual next
 * weight that is *higher* than the failed weight — legal, but worth noting.
 */
export function validateParams(rev: RevisionParams, failedWeightLb?: number): Warning[] {
  const warnings: Warning[] = [];

  if (rev.roundingStepLb > 0 && rev.incrementLb % rev.roundingStepLb !== 0) {
    warnings.push({
      code: 'increment_not_multiple_of_step',
      message: `Increment ${rev.incrementLb} is not a multiple of the rounding step ${rev.roundingStepLb}; prescribed weights may drift from a clean arithmetic series.`,
    });
  }

  if (rev.incrementLb === 0) {
    warnings.push({ code: 'zero_increment', message: 'Increment is 0; this exercise will never progress.' });
  }

  if (rev.failureMultiplier <= 0 || rev.failureMultiplier > 1) {
    warnings.push({
      code: 'failure_multiplier_out_of_range',
      message: `Failure multiplier ${rev.failureMultiplier} is outside the expected range (0, 1].`,
    });
  }

  if (failedWeightLb !== undefined && rev.startWeightLb > failedWeightLb) {
    warnings.push({
      code: 'manual_next_above_failed',
      message: `Manual next weight ${rev.startWeightLb} is higher than the failed weight ${failedWeightLb}.`,
    });
  }

  return warnings;
}
