import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { Id, Weekday } from '../schemas/common.js';
import { dayDto } from '../lib/serialize.js';
import { NotFound, Unprocessable } from '../lib/http-errors.js';

const dayRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    '/programs/:id/days',
    {
      schema: {
        params: Type.Object({ id: Id }),
        body: Type.Object({
          weekday: Weekday,
          label: Type.Optional(Type.String()),
          order: Type.Integer({ minimum: 0 }),
        }),
      },
    },
    async (req, reply) => {
      const program = await app.prisma.program.findUnique({ where: { id: req.params.id } });
      if (!program) throw new NotFound('program');
      // (programId, weekday) is unique — a duplicate weekday becomes a 409.
      const day = await app.prisma.day.create({
        data: {
          programId: req.params.id,
          weekday: req.body.weekday,
          label: req.body.label ?? null,
          order: req.body.order,
        },
        include: { exercises: { include: { revisions: { orderBy: { effectiveFromIndex: 'asc' } } } } },
      });
      return reply.status(201).send(dayDto(day));
    },
  );

  app.patch(
    '/days/:id',
    {
      schema: {
        params: Type.Object({ id: Id }),
        body: Type.Object({
          label: Type.Optional(Type.String()),
          order: Type.Optional(Type.Integer({ minimum: 0 })),
          weekday: Type.Optional(Weekday),
        }),
      },
    },
    async (req) => {
      // Changing a day's weekday re-dates its whole occurrence chain — forbidden
      // once logs exist (same reasoning as program startDate).
      if (req.body.weekday !== undefined) {
        const logCount = await app.prisma.sessionLog.count({
          where: { exercise: { dayId: req.params.id } },
        });
        if (logCount > 0) {
          throw new Unprocessable(
            'Cannot change a day’s weekday once it has logged sessions; create a new day and move exercises instead.',
          );
        }
      }
      const day = await app.prisma.day.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.label !== undefined ? { label: req.body.label } : {}),
          ...(req.body.order !== undefined ? { order: req.body.order } : {}),
          ...(req.body.weekday !== undefined ? { weekday: req.body.weekday } : {}),
        },
        include: { exercises: { include: { revisions: { orderBy: { effectiveFromIndex: 'asc' } } } } },
      });
      return dayDto(day);
    },
  );

  app.delete('/days/:id', { schema: { params: Type.Object({ id: Id }) } }, async (req, reply) => {
    await app.prisma.day.delete({ where: { id: req.params.id } });
    return reply.status(204).send();
  });
};

export default dayRoutes;
