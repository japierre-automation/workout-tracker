import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
  computeChain,
  dateForOccurrence,
  lastElapsedIndex,
  projectForward,
  type LogEntry,
  type Weekday,
} from '@wt/engine';
import { DateStr, Id, WeightLb } from '../schemas/common.js';
import { loadEngineInput } from '../lib/engine-io.js';
import { isoDate, dateOnly } from '../lib/dates.js';
import { Unprocessable } from '../lib/http-errors.js';

const OccurrenceParams = Type.Object({ id: Id, occurrenceIndex: Type.String({ pattern: '^\\d+$' }) });

const logRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.put(
    '/exercises/:id/logs/:occurrenceIndex',
    {
      schema: {
        params: OccurrenceParams,
        // `date` is the client's "today" — used only to reject logging the future
        // without consulting the server clock.
        querystring: Type.Object({ date: Type.Optional(DateStr) }),
        body: Type.Object({
          status: Type.Union([Type.Literal('done'), Type.Literal('failed')]),
          manualNextWeightLb: Type.Optional(WeightLb),
        }),
      },
    },
    async (req) => {
      const k = Number(req.params.occurrenceIndex);
      const { status, manualNextWeightLb } = req.body;

      if (status === 'done' && manualNextWeightLb !== undefined) {
        throw new Unprocessable('manualNextWeightLb is only valid when status is "failed".');
      }

      const { exercise, revisions, logs } = await loadEngineInput(app.prisma, req.params.id);
      const weekday = exercise.day.weekday as Weekday;
      const startDate = isoDate(exercise.day.program.startDate);

      // Future-logging guard (only enforceable when the client tells us "today").
      if (req.query.date !== undefined) {
        const maxIndex = lastElapsedIndex(startDate, weekday, req.query.date);
        if (k > maxIndex) {
          throw new Unprocessable('Cannot log a future occurrence.');
        }
      }

      // Prescribed weight at k, ignoring any pre-existing log at k itself.
      const prescribed = computeChain(
        revisions,
        logs.filter((l) => l.occurrenceIndex !== k),
        k,
      ).at(-1)!;
      const date = dateForOccurrence(startDate, weekday, k);

      const saved = await app.prisma.sessionLog.upsert({
        where: { exerciseId_occurrenceIndex: { exerciseId: req.params.id, occurrenceIndex: k } },
        create: {
          exerciseId: req.params.id,
          occurrenceIndex: k,
          date: dateOnly(date),
          status: status === 'failed' ? 'FAILED' : 'DONE',
          prescribedWeightLb: prescribed.weightLb,
          manualNextWeightLb: manualNextWeightLb ?? null,
        },
        update: {
          status: status === 'failed' ? 'FAILED' : 'DONE',
          manualNextWeightLb: manualNextWeightLb ?? null,
        },
      });

      // Next occurrence, derived from the updated log set, so the UI updates without
      // a second request.
      const newLog: LogEntry = { occurrenceIndex: k, status, manualNextWeightLb };
      const updatedLogs = [...logs.filter((l) => l.occurrenceIndex !== k), newLog];
      const next = projectForward(revisions, updatedLogs, k + 1, 1)[0]!;

      return {
        log: {
          occurrenceIndex: saved.occurrenceIndex,
          date: isoDate(saved.date),
          status,
          prescribedWeightLb: prescribed.weightLb,
          manualNextWeightLb: manualNextWeightLb ?? null,
        },
        nextOccurrence: {
          index: k + 1,
          date: dateForOccurrence(startDate, weekday, k + 1),
          weightLb: next.weightLb,
        },
      };
    },
  );

  app.delete(
    '/exercises/:id/logs/:occurrenceIndex',
    { schema: { params: OccurrenceParams } },
    async (req, reply) => {
      const k = Number(req.params.occurrenceIndex);
      // Idempotent: removing a non-existent log still leaves the occurrence "missed".
      await app.prisma.sessionLog.deleteMany({
        where: { exerciseId: req.params.id, occurrenceIndex: k },
      });
      return reply.status(204).send();
    },
  );
};

export default logRoutes;
