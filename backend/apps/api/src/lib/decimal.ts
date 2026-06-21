import { Prisma } from '@prisma/client';

/**
 * The single audited boundary between Postgres `Decimal` columns and the plain
 * `number`s the engine and JSON layer use. Keeping conversion here (and in
 * `engine-io.ts`, which builds on it) means a raw `Prisma.Decimal` never leaks
 * into the engine or a response by accident.
 */
export type Decimal = Prisma.Decimal;

export function toNumber(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'number' ? value : value.toNumber();
}

/** Non-null variant for fields that are guaranteed present. */
export function toNumberStrict(value: Prisma.Decimal | number): number {
  return typeof value === 'number' ? value : value.toNumber();
}

export function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

export function isDecimal(value: unknown): value is Prisma.Decimal {
  return value instanceof Prisma.Decimal;
}
