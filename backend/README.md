# Workout Tracker — Backend

A small pnpm monorepo:

- **`packages/engine`** (`@wt/engine`) — pure, zero-dependency progression logic
  (rounding, calendar math, `computeChain`/`projectForward`, validation). Shared so
  the React Native client can project weights with the identical code.
- **`apps/api`** (`@wt/api`) — Fastify + TypeScript + Prisma service. The API is the
  source of truth; prescribed weights are always derived from revision params + the
  ordered log list, never stored as primary data.

## Requirements

- Node 20+, pnpm 10+
- For production: a managed PostgreSQL (Railway recommended).
- For local dev/tests: **no Postgres needed** — an in-process PGlite database is
  used (see DB notes below).

## Install

```bash
pnpm install
```

## Develop & test

```bash
pnpm test          # engine unit tests + API integration tests (PGlite-backed)
pnpm typecheck     # strict typecheck across both packages
pnpm --filter @wt/engine build   # build the engine (API consumes its dist at runtime)
pnpm dev           # run the API (needs DATABASE_URL — see Deploy)
```

Tests run a real Postgres engine in-process (PGlite via `pglite-prisma-adapter`),
applying the committed migrations to a fresh database per suite. Engine edits are
picked up from source automatically (vitest aliases `@wt/engine` to `src`); the
running app uses the built `dist`, so run the engine build before `pnpm dev`.

## Database

- Schema: `apps/api/prisma/schema.prisma`. Weights are exact `Decimal`s in **kg**;
  dates are calendar `date`s.
- Migrations: `apps/api/prisma/migrations/` — the initial schema plus a hand-written
  partial unique index (`one_active_program`) that enforces "at most one active
  program" at the database level.
- The conversion between Postgres `Decimal` and plain `number` happens only in
  `src/lib/decimal.ts` / `src/lib/engine-io.ts`; a reply serializer hook throws
  loudly if a raw `Decimal` ever reaches JSON.

## Deploy (Railway)

1. Create a Railway project; add the **PostgreSQL** plugin.
2. Add a service from this repo with root directory `backend/` (or deploy
   `apps/api`). Build: `pnpm install && pnpm --filter @wt/engine build && pnpm --filter @wt/api build`.
   Start: `pnpm --filter @wt/api start`.
3. Set env vars (see `.env.example`): `DATABASE_URL` (reference the Postgres
   plugin), `PORT`, `HOST=0.0.0.0`, `API_KEY_ENABLED=false`.
4. Run migrations as a release/deploy step: `pnpm --filter @wt/api migrate:deploy`
   (`prisma migrate deploy`).

The service has no authentication for the MVP — it relies on Railway's private
network. To turn protection on later, set `API_KEY_ENABLED=true` and `API_KEY=...`;
the dormant `x-api-key` hook (`src/plugins/auth.ts`) activates with no code change.

## API surface (P0)

Programs: `GET/POST /programs`, `GET/PATCH/DELETE /programs/:id`,
`GET /programs/:id/stats`, `POST /programs/:id/activate`.
Days: `POST /programs/:id/days`, `PATCH/DELETE /days/:id`.
Exercises: `POST /days/:id/exercises`, `PATCH/DELETE /exercises/:id`,
`GET /exercises/:id/revisions`.
Logs: `PUT/DELETE /exercises/:id/logs/:occurrenceIndex`.
Views: `GET /views/today?date=`, `GET /views/week?date=`,
`GET /views/history?cursor=&limit=`.
