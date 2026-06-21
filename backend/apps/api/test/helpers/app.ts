import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { createTestDb } from './db.js';

export interface TestApp {
  app: FastifyInstance;
  prisma: PrismaClient;
  close: () => Promise<void>;
}

/** A fully-wired app backed by a fresh, isolated PGlite database. */
export async function makeApp(): Promise<TestApp> {
  const { prisma, close } = await createTestDb();
  const app = await buildApp({ prisma });
  return {
    app,
    prisma,
    close: async () => {
      await app.close();
      await close();
    },
  };
}
