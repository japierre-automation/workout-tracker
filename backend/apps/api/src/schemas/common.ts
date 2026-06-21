import { Type } from '@sinclair/typebox';

/** A weight in pounds. The API is lb-only — no `unit` field exists anywhere. */
export const WeightLb = Type.Number({ minimum: 0.001, maximum: 4000 });

/** A calendar date, `YYYY-MM-DD`. */
export const DateStr = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' });

/** A resource id (uuid). Kept permissive; a wrong id 404s downstream. */
export const Id = Type.String({ minLength: 1 });

/** ISO weekday: 0 = Monday … 6 = Sunday. */
export const Weekday = Type.Integer({ minimum: 0, maximum: 6 });

/** A non-blocking engine warning attached to mutating responses. */
export const Warning = Type.Object({
  code: Type.String(),
  message: Type.String(),
});

export const ErrorEnvelope = Type.Object({
  error: Type.String(),
  message: Type.String(),
  details: Type.Optional(Type.Unknown()),
});
