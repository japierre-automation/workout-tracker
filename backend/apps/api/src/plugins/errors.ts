import fp from 'fastify-plugin';
import type { FastifyError } from 'fastify';
import { Prisma } from '@prisma/client';
import { EngineError } from '@wt/engine';
import { HttpError } from '../lib/http-errors.js';

/** Single envelope for every error: `{ error, message, details? }`. */
export default fp(async (app) => {
  app.setErrorHandler((err: FastifyError, req, reply) => {
    // Fastify/TypeBox schema validation.
    if (err.validation) {
      return reply
        .status(400)
        .send({ error: 'validation_error', message: err.message, details: err.validation });
    }

    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.error, message: err.message });
    }

    if (err instanceof EngineError) {
      return reply.status(422).send({ error: 'engine_error', message: err.message });
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        return reply
          .status(409)
          .send({ error: 'conflict', message: 'Resource already exists', details: err.meta });
      }
      if (err.code === 'P2025') {
        return reply.status(404).send({ error: 'not_found', message: 'Resource not found' });
      }
    }

    // A bad explicit status from elsewhere in the stack.
    if (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: err.code ?? 'error', message: err.message });
    }

    req.log.error(err);
    return reply.status(500).send({ error: 'internal_error', message: 'Internal server error' });
  });
});
