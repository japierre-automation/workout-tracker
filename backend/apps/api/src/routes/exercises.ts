import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { computeChain, validateParams, type RevisionParams } from '@wt/engine';
import { Id, WeightLb } from '../schemas/common.js';
import { exerciseDto, revisionDto } from '../lib/serialize.js';
import { toEngineLog, toEngineRevision } from '../lib/engine-io.js';
import { NotFound } from '../lib/http-errors.js';

const ProgressionParams = {
  startWeightLb: WeightLb,
  sets: Type.Integer({ minimum: 1 }),
  reps: Type.Integer({ minimum: 1 }),
  incrementLb: Type.Number({ minimum: 0, maximum: 4000 }),
  roundingStepLb: Type.Number({ exclusiveMinimum: 0, maximum: 4000 }),
  failureMultiplier: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 2 })),
};

const DEFAULT_FAILURE_MULTIPLIER = 0.9;

const exerciseRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // Create exercise + its revision 0 (effectiveFromIndex 0) in one transaction.
  app.post(
    '/days/:id/exercises',
    {
      schema: {
        params: Type.Object({ id: Id }),
        body: Type.Object({
          name: Type.String({ minLength: 1 }),
          order: Type.Integer({ minimum: 0 }),
          ...ProgressionParams,
        }),
      },
    },
    async (req, reply) => {
      const day = await app.prisma.day.findUnique({ where: { id: req.params.id } });
      if (!day) throw new NotFound('day');

      const failureMultiplier = req.body.failureMultiplier ?? DEFAULT_FAILURE_MULTIPLIER;
      const { exercise, revision } = await app.prisma.$transaction(async (tx) => {
        const exercise = await tx.exercise.create({
          data: { dayId: req.params.id, name: req.body.name, order: req.body.order },
        });
        const revision = await tx.exerciseRevision.create({
          data: {
            exerciseId: exercise.id,
            effectiveFromIndex: 0,
            startWeightLb: req.body.startWeightLb,
            sets: req.body.sets,
            reps: req.body.reps,
            incrementLb: req.body.incrementLb,
            roundingStepLb: req.body.roundingStepLb,
            failureMultiplier,
          },
        });
        return { exercise, revision };
      });

      const warnings = validateParams(toEngineRevision(revision));
      return reply.status(201).send({
        ...exerciseDto({ ...exercise, revisions: [revision] }),
        warnings,
      });
    },
  );

  // PATCH splits by field type: name/order edit the row; any progression param
  // triggers the forward-only revision flow.
  app.patch(
    '/exercises/:id',
    {
      schema: {
        params: Type.Object({ id: Id }),
        body: Type.Object({
          name: Type.Optional(Type.String({ minLength: 1 })),
          order: Type.Optional(Type.Integer({ minimum: 0 })),
          startWeightLb: Type.Optional(WeightLb),
          sets: Type.Optional(Type.Integer({ minimum: 1 })),
          reps: Type.Optional(Type.Integer({ minimum: 1 })),
          incrementLb: Type.Optional(Type.Number({ minimum: 0, maximum: 4000 })),
          roundingStepLb: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 4000 })),
          failureMultiplier: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 2 })),
        }),
      },
    },
    async (req) => {
      const body = req.body;
      const hasProgression =
        body.startWeightLb !== undefined ||
        body.sets !== undefined ||
        body.reps !== undefined ||
        body.incrementLb !== undefined ||
        body.roundingStepLb !== undefined ||
        body.failureMultiplier !== undefined;

      const warnings = await app.prisma.$transaction(async (tx) => {
        const exercise = await tx.exercise.findUnique({ where: { id: req.params.id } });
        if (!exercise) throw new NotFound('exercise');

        if (body.name !== undefined || body.order !== undefined) {
          await tx.exercise.update({
            where: { id: req.params.id },
            data: {
              ...(body.name !== undefined ? { name: body.name } : {}),
              ...(body.order !== undefined ? { order: body.order } : {}),
            },
          });
        }

        if (!hasProgression) return [];

        const [revRows, logRows] = await Promise.all([
          tx.exerciseRevision.findMany({
            where: { exerciseId: req.params.id },
            orderBy: { effectiveFromIndex: 'asc' },
          }),
          tx.sessionLog.findMany({
            where: { exerciseId: req.params.id },
            orderBy: { occurrenceIndex: 'asc' },
          }),
        ]);
        const revisions = revRows.map(toEngineRevision);
        const logs = logRows.map(toEngineLog);

        // Next unlogged occurrence — the revision boundary. History before it is
        // untouched by construction (that is the forward-only guarantee).
        const lastLogged = logs.reduce((m, l) => Math.max(m, l.occurrenceIndex), -1);
        const n = lastLogged + 1;

        const chain = computeChain(revisions, logs, n);
        const base = revisions[revisions.length - 1]!; // params currently in effect
        const seed = body.startWeightLb ?? chain[n]!.weightLb; // override or carry-forward

        const merged: Omit<RevisionParams, 'effectiveFromIndex'> = {
          startWeightLb: seed,
          sets: body.sets ?? base.sets,
          reps: body.reps ?? base.reps,
          incrementLb: body.incrementLb ?? base.incrementLb,
          roundingStepLb: body.roundingStepLb ?? base.roundingStepLb,
          failureMultiplier: body.failureMultiplier ?? base.failureMultiplier,
        };

        // Upsert collapses repeated edits before the next session into one revision.
        await tx.exerciseRevision.upsert({
          where: { exerciseId_effectiveFromIndex: { exerciseId: req.params.id, effectiveFromIndex: n } },
          create: { exerciseId: req.params.id, effectiveFromIndex: n, ...merged },
          update: { ...merged },
        });

        return validateParams({ effectiveFromIndex: n, ...merged });
      });

      const exercise = await app.prisma.exercise.findUniqueOrThrow({
        where: { id: req.params.id },
        include: { revisions: { orderBy: { effectiveFromIndex: 'asc' } } },
      });
      return { ...exerciseDto(exercise), warnings };
    },
  );

  app.delete('/exercises/:id', { schema: { params: Type.Object({ id: Id }) } }, async (req, reply) => {
    await app.prisma.exercise.delete({ where: { id: req.params.id } });
    return reply.status(204).send();
  });

  // Expose the current revision list (handy for the editor); read-only.
  app.get('/exercises/:id/revisions', { schema: { params: Type.Object({ id: Id }) } }, async (req) => {
    const exercise = await app.prisma.exercise.findUnique({
      where: { id: req.params.id },
      include: { revisions: { orderBy: { effectiveFromIndex: 'asc' } } },
    });
    if (!exercise) throw new NotFound('exercise');
    return exercise.revisions.map(revisionDto);
  });
};

export default exerciseRoutes;
