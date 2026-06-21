import type { PrismaClient, ExerciseRevision, SessionLog } from '@prisma/client';
import type { LogEntry, RevisionParams } from '@wt/engine';
import { NotFound } from './http-errors.js';
import { toNumberStrict } from './decimal.js';

export function toEngineRevision(r: ExerciseRevision): RevisionParams {
  return {
    effectiveFromIndex: r.effectiveFromIndex,
    startWeightLb: toNumberStrict(r.startWeightLb),
    incrementLb: toNumberStrict(r.incrementLb),
    failureMultiplier: toNumberStrict(r.failureMultiplier),
    roundingStepLb: toNumberStrict(r.roundingStepLb),
    sets: r.sets,
    reps: r.reps,
  };
}

export function toEngineLog(l: SessionLog): LogEntry {
  return {
    occurrenceIndex: l.occurrenceIndex,
    status: l.status === 'FAILED' ? 'failed' : 'done',
    manualNextWeightLb: l.manualNextWeightLb == null ? undefined : toNumberStrict(l.manualNextWeightLb),
  };
}

/**
 * Load an exercise's revisions + logs (mapped to engine types) plus the exercise
 * with its day and program — everything a handler needs to drive the engine.
 * The Decimal→number conversion happens here, in one audited place.
 */
export async function loadEngineInput(prisma: PrismaClient, exerciseId: string) {
  const [revisions, logs, exercise] = await Promise.all([
    prisma.exerciseRevision.findMany({ where: { exerciseId }, orderBy: { effectiveFromIndex: 'asc' } }),
    prisma.sessionLog.findMany({ where: { exerciseId }, orderBy: { occurrenceIndex: 'asc' } }),
    prisma.exercise.findUnique({
      where: { id: exerciseId },
      include: { day: { include: { program: true } } },
    }),
  ]);
  if (!exercise) throw new NotFound('exercise');
  return {
    exercise,
    revisions: revisions.map(toEngineRevision),
    logs: logs.map(toEngineLog),
  };
}
