# Backend Progress

This file records what has been built on the backend and the decisions made during development.

> **Architecture & full API reference:** see [`backend/BACKEND.md`](backend/BACKEND.md)
> — the cold-start guide for making backend changes or building frontend against the
> API. This file is the chronological log; that file is how the system works.

## Completed Work

### Phase 0 — Workspace + DB test harness (done)
- Scaffolded `backend/` as a pnpm workspace (`packages/engine`, `apps/api`) with a
  shared strict `tsconfig.base.json` and vitest.
- **Verified:** ran a throwaway spike confirming the chosen in-process Postgres
  (PGlite) boots on this host, enforces a partial unique index
  (`CREATE UNIQUE INDEX ... WHERE is_active`), and round-trips `numeric(7,3)`
  Decimals exactly (`132.500`). Spike then removed.

### Phase 1 — Engine package `@wt/engine` (done)
- Pure, zero-runtime-dependency progression logic: `round` (half-up), `calendar`
  (occurrence ↔ date math on `YYYY-MM-DD` strings, UTC-noon internal), `progression`
  (`computeChain`/`projectForward` — every revision seeds its own weight, no future
  special case, clamp at one rounding step), `validateParams` (non-blocking warnings).
- **Verified (unit tests):** 23 tests pass, including the spec §4.2 Bench sequence
  `[135,140,145,130,135,140]` with the missed week, the manual-override variant
  `[…145,140,145…]`, failure on occurrence 0, mid-chain revision reseed, half-up tie
  rounding, `projectForward` ≡ `computeChain`, and a drift property test (W(k)=W(0)+k·I
  for k≤500 when increment is a multiple of step). Typechecks and builds clean.

### Phase 2 — Prisma schema + migrations (done)
- `schema.prisma` with Program / Day / Exercise / ExerciseRevision / SessionLog +
  `LogStatus` enum; weights as `Decimal`, dates as `@db.Date`. P2 `Settings` model
  omitted; nullable `Program.archivedAt` kept for forward-compat.
- Initial migration generated **offline** via `prisma migrate diff --from-empty
  --to-schema-datamodel --script` (no DB needed); a second hand-written migration
  adds the partial unique index `one_active_program` (Prisma can't express it).
- `lib/decimal.ts` — the single Decimal↔number conversion boundary.
- **Verified:** harness smoke test (`test/db-harness.test.ts`) creates the full
  schema in PGlite via the committed migrations, round-trips Decimals, and confirms
  the partial index rejects a second active program with Prisma `P2002`. 2 tests pass.

### Phase 3 — Fastify app skeleton (done)
- `buildApp()` (used by both `server.ts` and tests) wiring plugins: `config`
  (`@fastify/env`), `prisma` (injectable — tests pass a PGlite client; prod builds
  one from `DATABASE_URL`), central `errors` handler (`{error,message,details?}`;
  Prisma P2002→409 / P2025→404, TypeBox→400, EngineError→422, else 500), a
  Decimal-leak `serializer` guard, and a dormant `x-api-key` `auth` hook behind
  `API_KEY_ENABLED`. TypeBox type provider + `schemas/common.ts`.

### Phase 4 — engine-io + P0 routes (done)
- `lib/engine-io.ts` (load revisions+logs+exercise, Decimal→engine mapping),
  `lib/serialize.ts` (response DTOs), `lib/dates.ts`.
- Routes: programs (CRUD, `/stats`, `/activate` cross-row invariant, startDate
  guard), days (weekday-unique 409, weekday-change guard), exercises (create with
  revision 0; PATCH forward-only revision upsert), logs (server-derived date +
  prescribed snapshot, future/manual guards, `nextOccurrence`, idempotent delete),
  views (today / week with `dateStatus` / cursor-paginated history).

### Phase 5 — Verification (done)
- **Engine:** 23 unit tests (Phase 1).
- **API integration (inject against PGlite):** 18 tests across 4 files —
  - `cycle.test.ts`: the flagship spec §4.2 six-week cycle through the public API,
    asserting the prescribed sequence `[135,140,145,130,135,140]`, the missed week,
    failure drop (145→130), history feed, today view, and a forward-only increment
    edit that leaves history untouched.
  - `guards.test.ts`: startDate/weekday-change 422s, future-log 422, manual+done
    422, duplicate-weekday 409, single-active invariant, log idempotency, delete→
    missed, drift warning.
  - `contract.test.ts`: no response emits a `unit` field; every weight field ends
    in `Lb`.
  - `db-harness.test.ts`: schema/Decimal/partial-index smoke test.
- Note: per the user, the live-app TCP run was skipped; inject exercises the full
  HTTP stack (routing, validation, serialization, error mapping). Final live
  verification will happen against the Railway deployment.

### Phase 6 — Deploy handoff (done)
- `README.md` with Railway deploy steps, `.env.example`, `.gitignore`.
  Build order is topological via `pnpm -r build` (engine before api);
  `prisma migrate deploy` is the release step. **Next:** user deploys to Railway
  and we runtime-verify against the live URL.

### Phase 7 — Canonical unit switched kg → lb (done)
- Realized post-MVP that the project should store weights in **pounds**, not kg.
  Since the unit is hardcoded canonical (no `displayUnit`/toggle) and the frontend
  is still empty, this was a self-contained backend change: renamed every `*Kg`
  field → `*Lb` (`startWeightLb`, `incrementLb`, `roundingStepLb`,
  `prescribedWeightLb`, `manualNextWeightLb`, engine `weightLb`, schema `WeightLb`)
  across the engine, routes, serialization, schema, migration, tests, and
  `BACKEND.md`. The contract test now enforces a `Lb` suffix.
- Numbers adjusted for lb: weight `maximum` 2000 → **4000**; drift-example rounding
  steps 2.5 → 5. `failureMultiplier` (0.9) and Decimal precision are unit-agnostic
  and unchanged. The progression math is identical — fixtures still reproduce
  `[135,140,145,130,135,140]`, proving the rename was purely nominal.
- The kg↔lb conversion is now explicitly the **frontend's** job (see BACKEND.md §9
  "Talk lb").

## Decisions

### DB test harness: PGlite (not embedded-postgres)
The plan's primary choice, `embedded-postgres`, failed on this macOS/arm64 host: its
bundled Postgres binary references a missing ICU dylib (`libicudata.68.dylib`) and
aborts on init. Pivoted to the planned fallback, **PGlite** (`@electric-sql/pglite`),
an in-process WASM build of real Postgres — no native binaries, no Docker, no cloud.
It passed the spike (partial index + Decimal). Prisma talks to PGlite in tests via
`pglite-prisma-adapter@0.6.1` (compatible with Prisma 6; the 0.7.x line requires
Prisma 7). Production (Railway) uses a normal `DATABASE_URL` PrismaClient with no
adapter — same schema and migrations, only the client construction differs.
