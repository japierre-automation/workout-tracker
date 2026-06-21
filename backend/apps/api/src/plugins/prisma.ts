import fp from 'fastify-plugin';
import { PrismaClient } from '@prisma/client';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export interface PrismaPluginOptions {
  /** Injected client (tests use a PGlite-backed instance). */
  prisma?: PrismaClient;
}

/**
 * Exposes `app.prisma`. In production it constructs a client from `DATABASE_URL`;
 * tests inject a PGlite-backed client instead. The injected client's lifecycle is
 * owned by the test harness, so it is not disconnected on server shutdown.
 */
export default fp<PrismaPluginOptions>(async (app, opts) => {
  let prisma: PrismaClient;
  let ownsClient = false;

  if (opts.prisma) {
    prisma = opts.prisma;
  } else {
    if (!app.config.DATABASE_URL) {
      throw new Error('DATABASE_URL is required when no PrismaClient is injected');
    }
    prisma = new PrismaClient();
    ownsClient = true;
  }

  app.decorate('prisma', prisma);
  app.addHook('onClose', async () => {
    if (ownsClient) await prisma.$disconnect();
  });
});
