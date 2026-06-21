import fp from 'fastify-plugin';
import { isDecimal } from '../lib/decimal.js';

/**
 * Loud-failure guard: a raw `Prisma.Decimal` must never reach JSON (it would
 * silently become a `"132.5"` string). Every weight is converted to a `number` at
 * the engine-io / decimal boundary; if one slips through, this throws instead of
 * emitting bad data. Cheap to run at single-user scale.
 */
function assertNoDecimal(value: unknown, path = '$'): void {
  if (isDecimal(value)) {
    throw new Error(`Decimal leaked into response at ${path}; convert to number first`);
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoDecimal(v, `${path}[${i}]`));
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertNoDecimal(v, `${path}.${k}`);
  }
}

export default fp(async (app) => {
  app.setReplySerializer((payload) => {
    assertNoDecimal(payload);
    return JSON.stringify(payload);
  });
});
