import { EngineError } from './errors.js';

/**
 * Round `value` to the nearest multiple of `step`, ties going up.
 *
 * `Math.floor(q + 0.5)` (rather than `Math.round`) makes the half-up tie rule
 * explicit and uniform — weights are always positive, so this rounds e.g.
 * `round(132.5, 5) === 135`. The `toFixed(3)` clamps binary-float residue, since
 * lb values never need more than three decimals.
 */
export function round(value: number, step: number): number {
  if (step <= 0) throw new EngineError('rounding step must be positive');
  const snapped = Math.floor(value / step + 0.5) * step;
  return Number(snapped.toFixed(3));
}
