import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
  addDays,
  computeChain,
  occurrenceIndexFor,
  validateParams,
  weekdayOf,
  type RevisionParams,
  type Weekday,
} from '@wt/engine';
import { DateStr } from '../schemas/common.js';
import { isoDate } from '../lib/dates.js';
import { toNumber, toNumberStrict } from '../lib/decimal.js';
import { toEngineLog, toEngineRevision } from '../lib/engine-io.js';
import type { ExerciseRevision, SessionLog } from '@prisma/client';

/** The revision in effect at occurrence `k` (highest effectiveFromIndex <= k). */
function effectiveRevision(revisions: RevisionParams[], k: number): RevisionParams {
  return revisions.filter((r) => r.effectiveFromIndex <= k).at(-1) ?? revisions[0]!;
}

type ExerciseWithChainData = {
  id: string;
  name: string;
  order: number;
  revisions: ExerciseRevision[];
  logs: SessionLog[];
};

/** Build the per-exercise cell for a given occurrence index (null = not started). */
function exerciseCell(ex: ExerciseWithChainData, occurrenceIndex: number | null) {
  const revisions = ex.revisions.map(toEngineRevision);
  const logs = ex.logs.map(toEngineLog);

  if (occurrenceIndex === null) {
    const rev = revisions[0]!;
    return {
      id: ex.id,
      name: ex.name,
      occurrenceIndex: null,
      prescribedWeightLb: null,
      sets: rev.sets,
      reps: rev.reps,
      log: null,
      warnings: validateParams(rev),
    };
  }

  const prescribed = computeChain(revisions, logs, occurrenceIndex).at(-1)!;
  const logRow = ex.logs.find((l) => l.occurrenceIndex === occurrenceIndex) ?? null;
  return {
    id: ex.id,
    name: ex.name,
    occurrenceIndex,
    prescribedWeightLb: prescribed.weightLb,
    sets: prescribed.sets,
    reps: prescribed.reps,
    log: logRow
      ? {
          status: logRow.status === 'FAILED' ? ('failed' as const) : ('done' as const),
          prescribedWeightLb: toNumberStrict(logRow.prescribedWeightLb),
          manualNextWeightLb: toNumber(logRow.manualNextWeightLb),
        }
      : null,
    warnings: validateParams(effectiveRevision(revisions, occurrenceIndex)),
  };
}

const dayInclude = {
  exercises: {
    orderBy: { order: 'asc' as const },
    include: {
      revisions: { orderBy: { effectiveFromIndex: 'asc' as const } },
      logs: { orderBy: { occurrenceIndex: 'asc' as const } },
    },
  },
};

const viewRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // ---- Today ----
  app.get('/views/today', { schema: { querystring: Type.Object({ date: DateStr }) } }, async (req) => {
    const date = req.query.date;
    const program = await app.prisma.program.findFirst({
      where: { isActive: true },
      include: { days: { where: { weekday: weekdayOf(date) }, include: dayInclude } },
    });

    if (!program) return { date, program: null, day: null };
    const day = program.days[0] ?? null;
    if (!day) {
      return { date, program: { id: program.id, name: program.name }, day: null };
    }

    const startDate = isoDate(program.startDate);
    const idx = occurrenceIndexFor(startDate, day.weekday as Weekday, date);
    return {
      date,
      program: { id: program.id, name: program.name },
      day: {
        id: day.id,
        weekday: day.weekday,
        label: day.label,
        exercises: day.exercises.map((ex) => exerciseCell(ex, idx)),
      },
    };
  });

  // ---- This week (Monday–Sunday containing `date`) ----
  app.get('/views/week', { schema: { querystring: Type.Object({ date: DateStr }) } }, async (req) => {
    const date = req.query.date;
    const monday = addDays(date, -weekdayOf(date));
    const sunday = addDays(monday, 6);

    const program = await app.prisma.program.findFirst({
      where: { isActive: true },
      include: { days: { orderBy: { weekday: 'asc' }, include: dayInclude } },
    });

    if (!program) {
      return { date, weekStart: monday, weekEnd: sunday, program: null, days: [] };
    }

    const startDate = isoDate(program.startDate);
    const days = program.days.map((day) => {
      const wd = day.weekday as Weekday;
      const cellDate = addDays(monday, wd);
      const idx = occurrenceIndexFor(startDate, wd, cellDate);
      return {
        id: day.id,
        weekday: day.weekday,
        label: day.label,
        date: cellDate,
        exercises: day.exercises.map((ex) => {
          const cell = exerciseCell(ex, idx);
          let dateStatus: 'logged' | 'missed' | 'today' | 'upcoming';
          if (cell.log) dateStatus = 'logged';
          else if (cellDate === date) dateStatus = 'today';
          else if (cellDate < date) dateStatus = 'missed';
          else dateStatus = 'upcoming';
          return { ...cell, dateStatus };
        }),
      };
    });

    return { date, weekStart: monday, weekEnd: sunday, program: { id: program.id, name: program.name }, days };
  });

  // ---- History (what was actually logged), cursor-paginated ----
  app.get(
    '/views/history',
    {
      schema: {
        querystring: Type.Object({
          cursor: Type.Optional(Type.String()),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        }),
      },
    },
    async (req) => {
      const limit = req.query.limit ?? 30;
      const cursorId = req.query.cursor
        ? Buffer.from(req.query.cursor, 'base64').toString('utf8')
        : undefined;

      const rows = await app.prisma.sessionLog.findMany({
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
        include: { exercise: { include: { day: { include: { program: true } } } } },
      });

      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const items = page.map((r) => ({
        occurrenceIndex: r.occurrenceIndex,
        date: isoDate(r.date),
        status: r.status === 'FAILED' ? ('failed' as const) : ('done' as const),
        prescribedWeightLb: toNumberStrict(r.prescribedWeightLb),
        manualNextWeightLb: toNumber(r.manualNextWeightLb),
        exercise: { id: r.exercise.id, name: r.exercise.name },
        day: { id: r.exercise.day.id, weekday: r.exercise.day.weekday, label: r.exercise.day.label },
        program: { id: r.exercise.day.program.id, name: r.exercise.day.program.name },
      }));

      const nextCursor = hasMore
        ? Buffer.from(page[page.length - 1]!.id, 'utf8').toString('base64')
        : null;

      return { items, nextCursor };
    },
  );
};

export default viewRoutes;
