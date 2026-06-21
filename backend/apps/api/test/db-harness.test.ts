import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestDb } from './helpers/db.js';

describe('PGlite + Prisma harness', () => {
  let prisma: PrismaClient;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ prisma, close } = await createTestDb());
  });
  afterAll(async () => {
    await close();
  });

  it('round-trips a Decimal through a real schema', async () => {
    const program = await prisma.program.create({ data: { name: 'P', startDate: new Date('2026-01-05') } });
    const day = await prisma.day.create({ data: { programId: program.id, weekday: 0, order: 0 } });
    const ex = await prisma.exercise.create({ data: { dayId: day.id, name: 'Bench', order: 0 } });
    const rev = await prisma.exerciseRevision.create({
      data: {
        exerciseId: ex.id,
        effectiveFromIndex: 0,
        startWeightLb: '135.000',
        sets: 3,
        reps: 5,
        incrementLb: '5.000',
        roundingStepLb: '1.250',
      },
    });
    expect(rev.startWeightLb.toString()).toBe('135');
    expect(rev.roundingStepLb.toString()).toBe('1.25');
  });

  it('enforces the partial unique index (one active program)', async () => {
    await prisma.program.create({ data: { name: 'A', startDate: new Date('2026-01-05'), isActive: true } });
    await expect(
      prisma.program.create({ data: { name: 'B', startDate: new Date('2026-01-05'), isActive: true } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
