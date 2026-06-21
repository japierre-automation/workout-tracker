import { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '@prisma/client';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../prisma/migrations');

/**
 * Spin up a fresh in-process Postgres (PGlite) with all committed migrations
 * applied, wired to a PrismaClient via the PGlite driver adapter. Each call is a
 * fully isolated database — there is no shared state between suites.
 */
export async function createTestDb(): Promise<{ prisma: PrismaClient; close: () => Promise<void> }> {
  const pglite = new PGlite();
  await pglite.waitReady;

  const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d/.test(e.name))
    .map((e) => e.name)
    .sort();
  for (const name of migrations) {
    await pglite.exec(readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8'));
  }

  const prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) });
  return {
    prisma,
    close: async () => {
      await prisma.$disconnect();
      await pglite.close();
    },
  };
}
