import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { DateStr, Id } from '../schemas/common.js';
import { dateOnly } from '../lib/dates.js';
import { programDetail, programSummary } from '../lib/serialize.js';
import { NotFound, Unprocessable } from '../lib/http-errors.js';

const programRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // List programs (live by default; ?archived=true for archived ones).
  app.get(
    '/programs',
    { schema: { querystring: Type.Object({ archived: Type.Optional(Type.Boolean()) }) } },
    async (req) => {
      const archived = req.query.archived ?? false;
      const programs = await app.prisma.program.findMany({
        where: { archivedAt: archived ? { not: null } : null },
        orderBy: { createdAt: 'desc' },
      });
      return programs.map(programSummary);
    },
  );

  app.post(
    '/programs',
    { schema: { body: Type.Object({ name: Type.String({ minLength: 1 }), startDate: DateStr }) } },
    async (req, reply) => {
      const program = await app.prisma.program.create({
        data: { name: req.body.name, startDate: dateOnly(req.body.startDate) },
      });
      return reply.status(201).send(programSummary(program));
    },
  );

  app.get('/programs/:id', { schema: { params: Type.Object({ id: Id }) } }, async (req) => {
    const program = await app.prisma.program.findUnique({
      where: { id: req.params.id },
      include: {
        days: {
          orderBy: { order: 'asc' },
          include: {
            exercises: {
              orderBy: { order: 'asc' },
              include: { revisions: { orderBy: { effectiveFromIndex: 'asc' } } },
            },
          },
        },
      },
    });
    if (!program) throw new NotFound('program');
    return programDetail(program);
  });

  app.patch(
    '/programs/:id',
    {
      schema: {
        params: Type.Object({ id: Id }),
        body: Type.Object({
          name: Type.Optional(Type.String({ minLength: 1 })),
          startDate: Type.Optional(DateStr),
        }),
      },
    },
    async (req) => {
      // Re-dating a program with logs would silently re-index every occurrence.
      if (req.body.startDate !== undefined) {
        const logCount = await app.prisma.sessionLog.count({
          where: { exercise: { day: { programId: req.params.id } } },
        });
        if (logCount > 0) {
          throw new Unprocessable(
            'Cannot change startDate on a program that has logged sessions; create a new program instead.',
          );
        }
      }
      const program = await app.prisma.program.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.name !== undefined ? { name: req.body.name } : {}),
          ...(req.body.startDate !== undefined ? { startDate: dateOnly(req.body.startDate) } : {}),
        },
      });
      return programSummary(program);
    },
  );

  // Cheap pre-delete confirmation payload.
  app.get('/programs/:id/stats', { schema: { params: Type.Object({ id: Id }) } }, async (req) => {
    const program = await app.prisma.program.findUnique({ where: { id: req.params.id } });
    if (!program) throw new NotFound('program');
    const [dayCount, exerciseCount, logCount] = await Promise.all([
      app.prisma.day.count({ where: { programId: req.params.id } }),
      app.prisma.exercise.count({ where: { day: { programId: req.params.id } } }),
      app.prisma.sessionLog.count({ where: { exercise: { day: { programId: req.params.id } } } }),
    ]);
    return { dayCount, exerciseCount, logCount };
  });

  app.delete('/programs/:id', { schema: { params: Type.Object({ id: Id }) } }, async (req, reply) => {
    await app.prisma.program.delete({ where: { id: req.params.id } });
    return reply.status(204).send();
  });

  // Activation is a cross-row invariant: at most one active program. The
  // transaction plus the `one_active_program` partial index guarantee it.
  app.post('/programs/:id/activate', { schema: { params: Type.Object({ id: Id }) } }, async (req) => {
    const program = await app.prisma.$transaction(async (tx) => {
      await tx.program.updateMany({ data: { isActive: false }, where: { isActive: true } });
      return tx.program.update({ where: { id: req.params.id }, data: { isActive: true } });
    });
    return programSummary(program);
  });
};

export default programRoutes;
