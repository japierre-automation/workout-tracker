import Fastify, { type FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { PrismaClient } from '@prisma/client';

import configPlugin from './plugins/config.js';
import prismaPlugin from './plugins/prisma.js';
import errorsPlugin from './plugins/errors.js';
import serializerPlugin from './plugins/serializer.js';
import authPlugin from './plugins/auth.js';

import programRoutes from './routes/programs.js';
import dayRoutes from './routes/days.js';
import exerciseRoutes from './routes/exercises.js';
import logRoutes from './routes/logs.js';
import viewRoutes from './routes/views.js';

export interface BuildAppOptions {
  /** Injected PrismaClient (tests pass a PGlite-backed instance). */
  prisma?: PrismaClient;
  logger?: boolean;
}

/** Builds a fully-wired Fastify instance. Used by both `server.ts` and tests. */
export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false }).withTypeProvider<TypeBoxTypeProvider>();

  // config first — prisma and auth read from app.config.
  await app.register(configPlugin);
  await app.register(serializerPlugin);
  await app.register(errorsPlugin);
  await app.register(prismaPlugin, { prisma: opts.prisma });
  await app.register(authPlugin);

  app.get('/health', async () => ({ status: 'ok' as const }));

  await app.register(programRoutes);
  await app.register(dayRoutes);
  await app.register(exerciseRoutes);
  await app.register(logRoutes);
  await app.register(viewRoutes);

  await app.ready();
  return app;
}
