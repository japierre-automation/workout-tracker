import type { Day, Exercise, ExerciseRevision, Program } from '@prisma/client';
import { isoDate } from './dates.js';
import { toNumberStrict } from './decimal.js';

/** Response DTO mappers. Converting Decimal→number and Date→string here keeps
 * raw Prisma rows (and Decimals) out of JSON responses. */

export function revisionDto(r: ExerciseRevision) {
  return {
    id: r.id,
    effectiveFromIndex: r.effectiveFromIndex,
    startWeightLb: toNumberStrict(r.startWeightLb),
    sets: r.sets,
    reps: r.reps,
    incrementLb: toNumberStrict(r.incrementLb),
    failureMultiplier: toNumberStrict(r.failureMultiplier),
    roundingStepLb: toNumberStrict(r.roundingStepLb),
  };
}

export function exerciseDto(e: Exercise & { revisions?: ExerciseRevision[] }) {
  const revs = e.revisions ?? [];
  const latest = revs.length > 0 ? revs[revs.length - 1]! : null;
  return {
    id: e.id,
    name: e.name,
    order: e.order,
    latestRevision: latest ? revisionDto(latest) : null,
  };
}

export function dayDto(d: Day & { exercises?: (Exercise & { revisions?: ExerciseRevision[] })[] }) {
  return {
    id: d.id,
    weekday: d.weekday,
    label: d.label,
    order: d.order,
    exercises: (d.exercises ?? []).map(exerciseDto),
  };
}

export function programSummary(p: Program) {
  return {
    id: p.id,
    name: p.name,
    isActive: p.isActive,
    startDate: isoDate(p.startDate),
    archivedAt: p.archivedAt ? p.archivedAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function programDetail(
  p: Program & {
    days?: (Day & { exercises?: (Exercise & { revisions?: ExerciseRevision[] })[] })[];
  },
) {
  return { ...programSummary(p), days: (p.days ?? []).map(dayDto) };
}
