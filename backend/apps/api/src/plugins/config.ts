import fp from 'fastify-plugin';
import env from '@fastify/env';

export interface AppConfig {
  DATABASE_URL?: string;
  PORT: number;
  HOST: string;
  API_KEY_ENABLED: boolean;
  API_KEY: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
  }
}

const schema = {
  type: 'object',
  properties: {
    // Optional: unused when a PrismaClient is injected (tests). Required in prod,
    // where the prisma plugin throws a clear error if it is missing.
    DATABASE_URL: { type: 'string' },
    PORT: { type: 'number', default: 3000 },
    HOST: { type: 'string', default: '0.0.0.0' },
    API_KEY_ENABLED: { type: 'boolean', default: false },
    API_KEY: { type: 'string', default: '' },
  },
} as const;

/** Loads and validates environment configuration onto `app.config`. Tests inject
 * env directly, so `.env` loading is skipped there (and avoids noisy output). */
export default fp(async (app) => {
  await app.register(env, { schema, confKey: 'config', dotenv: process.env.NODE_ENV !== 'test' });
});
