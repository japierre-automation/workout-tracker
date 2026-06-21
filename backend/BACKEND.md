# Workout Tracker — Backend Reference

This is the cold-start reference for the backend. Read it before making backend
changes, or before building frontend features against the API. It documents the
architecture, the progression engine, the data model, **every** endpoint with its
request/response shapes, the invariants, and step-by-step recipes for common
changes.

For a chronological log of what was built and why, see
[`../backend_progress.md`](../backend_progress.md). This file is the *how it works*;
that file is the *what happened*.

---

## 1. Core ideas (read this first)

Five ideas explain almost every design choice:

1. **Derived-on-read, never stored.** Prescribed weights are *computed* from an
   exercise's progression parameters plus its ordered list of logs — they are not
   primary data. The only stored weight that is "frozen" is `prescribedWeightLb` on
   each `SessionLog`, a historical snapshot of *what the app told you that day*. This
   is why editing a past log is cheap (downstream weights are recomputed on the next
   read) and why there are no caches or denormalized "current weight" columns.

2. **The engine is the single source of truth for math.** All weight/date logic
   lives in the pure, dependency-free `@wt/engine` package. No route handler ever
   computes a weight itself — it loads inputs, calls the engine, and persists/returns
   the result. The same package can run on the React Native client for instant
   projection (see §9).

3. **Calendar dates, never instants.** Everything is `YYYY-MM-DD` strings and
   Postgres `date` columns. The server never reads a clock. Endpoints that need
   "today" take an explicit `?date=` query param supplied by the client (which knows
   the user's local date). This makes handlers pure and immune to time-zone bugs.

4. **lb is canonical, everywhere.** The API only ever accepts and returns pounds.
   Every weight field name ends in `Lb`. There is **no `unit` field** anywhere (a
   contract test enforces both rules). A lb/kg toggle is purely client-side display.

5. **Forward-only edits.** Editing an exercise's progression parameters never
   rewrites history. Parameters are *versioned* in `ExerciseRevision` rows, each with
   the occurrence index it takes effect from. Editing creates/updates a revision at
   the next unlogged occurrence; everything before it is untouched by construction.

---

## 2. Repository layout

A pnpm workspace rooted at `backend/`:

```
backend/
├── package.json            # workspace root; scripts: build, test, typecheck, dev
├── pnpm-workspace.yaml      # packages: ["packages/*", "apps/*"]
├── tsconfig.base.json       # strict TS, ES2023, NodeNext ESM
├── packages/
│   └── engine/              # @wt/engine — pure progression logic, zero runtime deps
│       ├── src/{round,calendar,progression,validate,types,errors,index}.ts
│       └── test/*.test.ts   # plain vitest unit tests, no DB
└── apps/
    └── api/                 # @wt/api — Fastify service
        ├── prisma/
        │   ├── schema.prisma
        │   └── migrations/  # committed SQL migrations (run by prisma migrate deploy)
        ├── src/
        │   ├── app.ts       # buildApp() — registers plugins + routes (used by tests)
        │   ├── server.ts    # entrypoint: buildApp().listen()
        │   ├── plugins/{config,prisma,errors,serializer,auth}.ts
        │   ├── lib/{decimal,dates,engine-io,serialize,http-errors}.ts
        │   ├── schemas/common.ts
        │   └── routes/{programs,days,exercises,logs,views}.ts
        ├── test/            # vitest integration tests (PGlite-backed)
        └── vitest.config.ts # aliases @wt/engine -> source for tests
```

**Module system:** ESM throughout (`"type": "module"`), TypeScript `NodeNext`. Local
imports use explicit `.js` extensions (e.g. `import { round } from './round.js'`)
even though the source is `.ts` — this is required by NodeNext.

**Engine resolution gotcha:** `@wt/engine`'s package `exports` point at its built
`dist/`. So **build the engine** (`pnpm --filter @wt/engine build`) before running
the API with `pnpm dev` or `pnpm start`. Tests don't need this — `vitest.config.ts`
aliases `@wt/engine` to the TypeScript source so engine edits are picked up live.

---

## 3. Tech stack

| Concern        | Choice |
|----------------|--------|
| Runtime        | Node 20+, pnpm 10+ |
| HTTP framework | Fastify 5 |
| Schemas/types  | TypeBox + `@fastify/type-provider-typebox` (route schemas double as static types) |
| ORM            | Prisma 6 (`@prisma/client`) |
| Config         | `@fastify/env` |
| DB (prod)      | PostgreSQL (Railway) |
| DB (dev/test)  | **PGlite** (in-process WASM Postgres) via `pglite-prisma-adapter` — no Docker, no cloud |
| Tests          | vitest; API tests use `fastify.inject()` against PGlite |

Why PGlite for tests: the originally-planned `embedded-postgres` ships a broken ICU
binary on this macOS/arm64 host. PGlite is real Postgres compiled to WASM, so partial
indexes, `Decimal`, transactions, and DDL all behave faithfully. Production uses a
normal `DATABASE_URL` PrismaClient (no adapter); tests inject a PGlite-backed client.
Same schema, same migrations — only the client construction differs.

---

## 4. The progression engine (`@wt/engine`)

Pure functions, no I/O, no dependencies. Everything here is unit-testable without a
database. Source: `packages/engine/src/`.

### 4.1 Domain vocabulary

- **Occurrence index (`k`)**: 0-based count of how many times a weekday-slot has come
  around since the program started. Occurrence 0 is the first time that weekday occurs
  on/after the program `startDate`; occurrence 1 is 7 days later; etc.
- **Weekday**: ISO index **0 = Monday … 6 = Sunday** (note: *not* JS's Sunday=0).
- **Revision**: a versioned parameter set for one exercise, effective from a given
  occurrence index. Every exercise has at least revision 0 (`effectiveFromIndex: 0`).
- **Log**: a recorded outcome (`done` | `failed`) at a specific occurrence. Absence of
  a log for a *past* occurrence means **missed** — never stored explicitly.

### 4.2 Key types

```ts
type Weekday = 0|1|2|3|4|5|6;          // Mon..Sun
type LogStatus = 'done' | 'failed';

interface RevisionParams {
  effectiveFromIndex: number;
  startWeightLb: number;   // the prescribed weight AT effectiveFromIndex (revision seeds its own weight)
  incrementLb: number;
  failureMultiplier: number;
  roundingStepLb: number;
  sets: number;
  reps: number;
}

interface LogEntry {
  occurrenceIndex: number;
  status: LogStatus;
  manualNextWeightLb?: number;  // only meaningful with status 'failed'
}

interface Prescribed { occurrenceIndex: number; weightLb: number; sets: number; reps: number; }
interface Warning { code: string; message: string; }
```

### 4.3 The recurrence rule (the heart of it)

`computeChain(revisions, logs, throughIndex)` returns the `Prescribed` weight for
every occurrence `0..throughIndex`. For each `k`, the weight `W(k)` is:

- **A revision takes effect at `k`** (`effectiveFromIndex === k`, including revision 0):
  `W(k) = round(revision.startWeightLb, step)`. The revision *seeds* the weight.
- **Otherwise, look at the previous occurrence `k-1`:**
  - if its log is `failed`: `W(k) = round(manualNextWeightLb ?? W(k-1) * failureMultiplier, step)`
  - else (`done`, **missed** = no log, or **future** = no log yet): `W(k) = round(W(k-1) + incrementLb, step)`
- Finally clamp: `W(k) = max(W(k), step)` so a failure spiral can never reach 0.

The elegance: `done`, `missed`, and `future` all share the "add increment" branch, so
missed days progress for free and projection is just the same walk extended past the
last log. Because every revision seeds its own weight, revision boundaries never
interact with failure logic.

`round(value, step)` rounds to the nearest multiple of `step`, **ties going up**
(`round(132.5, 5) === 135`).

`projectForward(revisions, logs, fromIndex, count)` = `computeChain(... fromIndex+count-1).slice(fromIndex)`.

Worked example (start 135, increment 5, multiplier 0.9, step 5; logs:
done@0, done@1, failed@2, done@3, nothing@4):
`[135, 140, 145, 130, 135, 140]` — note 145→130 is the 90% failure drop, and index 5
(140) is derived even though index 4 was never logged (missed).

### 4.4 Calendar functions

All take/return `YYYY-MM-DD` strings; internal math uses UTC-noon to dodge DST.

| Function | Meaning |
|----------|---------|
| `firstOccurrence(startDate, weekday)` | first date ≥ startDate on that weekday |
| `dateForOccurrence(startDate, weekday, index)` | date of occurrence `index` |
| `occurrenceIndexFor(startDate, weekday, date)` | inverse; `null` if before first or wrong weekday |
| `lastElapsedIndex(startDate, weekday, today)` | highest index with date ≤ today; `-1` if none |
| `weekdayOf(date)` | ISO weekday (0=Mon) of a date |
| `addDays(date, n)` | add/subtract whole days |

### 4.5 Validation

`validateParams(rev, failedWeightLb?)` returns non-blocking `Warning[]` (never
throws). Warning codes: `increment_not_multiple_of_step`, `zero_increment`,
`failure_multiplier_out_of_range`, `manual_next_above_failed`. Routes attach these to
mutating responses so the client can toast them without blocking the save.

---

## 5. Data model (Prisma)

Source: `apps/api/prisma/schema.prisma`. Weights are `Decimal` (exact), dates are
`@db.Date`.

```
Program (1)──<(many) Day (1)──<(many) Exercise (1)──<(many) ExerciseRevision
                                              └──<(many) SessionLog
```

- **Program** — `id, name, isActive, startDate (date), archivedAt (nullable, P2),
  createdAt, updatedAt`. At most one program may have `isActive = true`, enforced by a
  hand-written **partial unique index** `one_active_program` (a constant-true
  expression index `WHERE "isActive"`).
- **Day** — `id, programId, weekday (int 0–6), label?, order`. `@@unique([programId,
  weekday])` → a duplicate weekday is a 409.
- **Exercise** — `id, dayId, name, order`. Holds identity/display only; parameters
  live in revisions.
- **ExerciseRevision** — `id, exerciseId, effectiveFromIndex, startWeightLb, sets,
  reps, incrementLb, failureMultiplier (default 0.900), roundingStepLb, createdAt`.
  `@@unique([exerciseId, effectiveFromIndex])`. `startWeightLb` is *the prescribed
  weight at `effectiveFromIndex`* — every revision seeds its own weight.
- **SessionLog** — `id, exerciseId, date (date), occurrenceIndex, prescribedWeightLb
  (snapshot at write time), status (DONE|FAILED), manualNextWeightLb?, createdAt,
  updatedAt`. `@@unique([exerciseId, occurrenceIndex])` makes log writes a natural
  idempotent upsert. **MISSED is never stored** — it's derived (past + no log).

All cascade on delete (deleting a program removes its days → exercises → revisions →
logs).

---

## 6. API conventions

- **Base:** all routes are unprefixed (e.g. `POST /programs`). JSON in/out.
- **No auth (MVP).** A dormant `x-api-key` preHandler exists
  (`src/plugins/auth.ts`); enable later with `API_KEY_ENABLED=true` + `API_KEY=...`,
  no code change.
- **Error envelope:** every error is `{ error: string, message: string, details?: unknown }`.

  | Cause | Status | `error` |
  |-------|--------|---------|
  | TypeBox validation failure | 400 | `validation_error` (with `details`) |
  | Missing resource (handler) | 404 | `not_found` |
  | Prisma `P2025` | 404 | `not_found` |
  | Unique violation `P2002` (e.g. dup weekday) | 409 | `conflict` |
  | Domain rule violation | 422 | `unprocessable_entity` |
  | Engine error | 422 | `engine_error` |
  | Anything else | 500 | `internal_error` (logged, redacted) |

- **Warnings vs errors:** `warnings` (non-blocking) are returned in the body of
  successful mutating responses; they never change the status code.
- **Dates:** request `?date=` params and all date fields are `YYYY-MM-DD`. Timestamp
  fields (`createdAt`, `updatedAt`, `archivedAt`) are full ISO-8601 strings.
- **Decimal safety:** a reply serializer hook throws if a raw `Prisma.Decimal` ever
  reaches JSON; all weights are converted to `number` first. So every weight in a
  response is a plain JSON number.

---

## 7. API reference (P0)

Shared DTO shapes referenced below:

```ts
// Program (summary)
{ id, name, isActive, startDate: "YYYY-MM-DD", archivedAt: string|null, createdAt, updatedAt }
// Revision
{ id, effectiveFromIndex, startWeightLb, sets, reps, incrementLb, failureMultiplier, roundingStepLb }
// Exercise (summary)
{ id, name, order, latestRevision: Revision|null }
// Day
{ id, weekday, label: string|null, order, exercises: Exercise[] }
// Warning
{ code, message }
```

### Health

**`GET /health`** → `200 { "status": "ok" }`

### Programs

**`GET /programs?archived=<bool>`** → `200 Program[]` (live programs by default;
`archived=true` lists archived — none in P0). Ordered newest-first.

**`POST /programs`** body `{ name: string, startDate: "YYYY-MM-DD" }` → `201 Program`.

**`GET /programs/:id`** → `200 ProgramDetail` = `Program` + `days: Day[]` (days,
exercises, and each exercise's full revision list, all ordered). `404` if missing.
This is the editor-screen payload.

**`PATCH /programs/:id`** body `{ name?, startDate? }` → `200 Program`.
- `422` if `startDate` is changed while the program has any logs (it would re-date the
  whole occurrence chain — create a new program instead).

**`GET /programs/:id/stats`** → `200 { dayCount, exerciseCount, logCount }`. Cheap
pre-delete confirmation (so the UI can warn "this destroys N logs"). `404` if missing.

**`DELETE /programs/:id`** → `204`. Cascades to days/exercises/revisions/logs.

**`POST /programs/:id/activate`** → `200 Program`. Transactionally clears any other
active program and activates this one (the partial unique index guarantees ≤1 active).

### Days

**`POST /programs/:id/days`** body `{ weekday: 0–6, label?, order: int }` → `201 Day`.
`404` if program missing; `409` if that weekday already exists in the program.

**`PATCH /days/:id`** body `{ label?, order?, weekday? }` → `200 Day`.
- `422` if `weekday` is changed while the day's exercises have logs.

**`DELETE /days/:id`** → `204`.

### Exercises

**`POST /days/:id/exercises`** body:
```jsonc
{ "name": string, "order": int,
  "startWeightLb": number, "sets": int≥1, "reps": int≥1,
  "incrementLb": number≥0, "roundingStepLb": number>0,
  "failureMultiplier": number   // optional, default 0.9
}
```
→ `201 { ...Exercise, warnings: Warning[] }`. Creates the `Exercise` **and** its
revision 0 in one transaction. `404` if day missing.

**`PATCH /exercises/:id`** body (all optional)
`{ name?, order?, startWeightLb?, sets?, reps?, incrementLb?, roundingStepLb?, failureMultiplier? }`
→ `200 { ...Exercise, warnings: Warning[] }`. `404` if missing.
- `name`/`order` update the row in place.
- **Any progression param** triggers the forward-only revision flow: it upserts a
  revision at `n = lastLoggedIndex + 1`. Its `startWeightLb` is `body.startWeightLb`
  if provided, else the carried-forward chain weight at `n`; other params default to
  the latest revision's values. Editing repeatedly before the next session collapses
  into a single revision (upsert on `[exerciseId, n]`). If no logs exist yet, `n = 0`,
  so it edits revision 0 in place.

**`DELETE /exercises/:id`** → `204`.

**`GET /exercises/:id/revisions`** → `200 Revision[]` (ordered by `effectiveFromIndex`).
`404` if missing.

### Logs

**`PUT /exercises/:id/logs/:occurrenceIndex?date=<today>`** body
`{ status: "done"|"failed", manualNextWeightLb?: number }` → `200`:
```jsonc
{
  "log": { "occurrenceIndex", "date": "YYYY-MM-DD", "status",
           "prescribedWeightLb": number,            // snapshot at write time
           "manualNextWeightLb": number|null },
  "nextOccurrence": { "index", "date": "YYYY-MM-DD", "weightLb": number }  // so the UI shows "next time" without a second call
}
```
- Idempotent upsert keyed on `[exerciseId, occurrenceIndex]` (double-tap Done is
  harmless). The log `date` and `prescribedWeightLb` are **derived server-side**, not
  taken from the client.
- `?date=` is the client's "today", used **only** to reject logging the future. It is
  optional; when supplied, `422` if `occurrenceIndex > lastElapsedIndex(today)`.
- `422` if `manualNextWeightLb` is sent with `status: "done"`.

**`DELETE /exercises/:id/logs/:occurrenceIndex`** → `204`. Idempotent; reverts the
occurrence to derived-missed.

### Views (read models)

All take `?date=YYYY-MM-DD` (the client's today) and resolve the **active** program at
request time.

**`GET /views/today?date=`** → `200`:
```jsonc
{ "date", "program": { "id", "name" } | null,
  "day": { "id", "weekday", "label",
           "exercises": [ ExerciseCell ] } | null }   // day is null if no active program or no day for that weekday
```
where `ExerciseCell` =
```jsonc
{ "id", "name", "occurrenceIndex": int|null, "prescribedWeightLb": number|null,
  "sets", "reps",
  "log": { "status", "prescribedWeightLb", "manualNextWeightLb": number|null } | null,
  "warnings": Warning[] }
```
(`occurrenceIndex`/`prescribedWeightLb` are `null` only when `date` precedes the
program's first occurrence for that weekday.)

**`GET /views/week?date=`** → `200`:
```jsonc
{ "date", "weekStart": "<Mon>", "weekEnd": "<Sun>",
  "program": { "id", "name" } | null,
  "days": [ { "id", "weekday", "label", "date": "<cell date>",
              "exercises": [ ExerciseCell & { "dateStatus": "logged"|"missed"|"today"|"upcoming" } ] } ] }
```
`dateStatus` precedence: `logged` if a log exists; else `today` if the cell date equals
`?date`; else `missed` if the cell date is in the past; else `upcoming`. Future cells'
weights are the projection — "see future workouts" comes for free.

**`GET /views/history?cursor=&limit=`** → `200`:
```jsonc
{ "items": [ { "occurrenceIndex", "date", "status",
               "prescribedWeightLb": number, "manualNextWeightLb": number|null,
               "exercise": { "id", "name" },
               "day": { "id", "weekday", "label" },
               "program": { "id", "name" } } ],
  "nextCursor": string|null }
```
Ordered by `(date desc, id desc)`. `limit` defaults to 30 (max 100). Pass the returned
`nextCursor` back as `?cursor=` for the next page; `null` means no more. **Only
actually-logged sessions appear** — derived-missed days show in the week view, not
here.

> Note on snapshots: an `ExerciseCell.prescribedWeightLb` is the *derived* current
> value, while `ExerciseCell.log.prescribedWeightLb` (and the history feed's
> `prescribedWeightLb`) is the *snapshot* recorded at write time. After a past-log
> edit these can differ; surfacing that difference is a P1 ("recomputed") concern.

---

## 8. Local development & testing

```bash
pnpm install
pnpm test                         # engine unit tests + API integration tests (PGlite)
pnpm typecheck                    # strict typecheck, both packages
pnpm --filter @wt/engine build    # build engine before running the API
pnpm --filter @wt/engine test     # engine only
pnpm --filter @wt/api test        # API only
```

- **No Postgres required.** API tests spin up a fresh PGlite database per suite via
  `apps/api/test/helpers/db.ts` (`createTestDb()`), applying the committed migration
  SQL files in order. `makeApp()` (`test/helpers/app.ts`) builds the real app with the
  PGlite-backed client injected and returns `{ app, prisma, close }`.
- Tests drive the app with `app.inject(...)` (full HTTP stack: routing, validation,
  serialization, error mapping) — no socket. The flagship `test/cycle.test.ts` replays
  the spec §4.2 six-week cycle through the public API.
- `buildApp({ prisma })` accepts an injected client; without one it constructs a
  PrismaClient from `DATABASE_URL`.

---

## 9. Frontend integration notes

- **Talk lb.** Send and read pounds only. Do lb/kg conversion at render and convert
  user input back to lb before calling the API. There is no `unit` field.
- **Supply `date`.** For `/views/*` and the future-log guard, pass the user's local
  calendar date as `?date=YYYY-MM-DD`. The server has no clock.
- **One call per screen.** `/views/today`, `/views/week`, and `/views/history` are
  designed to render a screen each without follow-up requests. After logging,
  `nextOccurrence` in the `PUT` response updates the "next time" display in place.
- **Show the failure drop without computing it.** Read `nextOccurrence.weightLb` from
  the log response (e.g. "next: 130 lb") — never recompute the 90% drop in UI code.
- **Optional client-side projection.** `@wt/engine` is dependency-free and can be
  imported by the React Native app to project weights instantly (offline / optimistic
  UI) using the *same* `computeChain`/`projectForward` the server uses. Feed it the
  exercise's revisions + logs (same shapes as §4.2). The server remains authoritative;
  the client projection is just a mirror. (To consume it in RN you'll either build the
  package or point the bundler at its `src`.)
- **Empty states.** `/views/today` returns `day: null` when there's no active program
  or no day for that weekday; `/views/week` returns `days: []` similarly.

---

## 10. Recipes for backend changes

**Add an endpoint.** Add a handler in the relevant `src/routes/*.ts` (or a new file
registered in `src/app.ts`). Declare TypeBox `schema` for params/query/body so types
are derived and validation is automatic. Build the response via a DTO mapper in
`src/lib/serialize.ts` (convert every `Decimal` to `number`). Never compute a weight
inline — use `loadEngineInput` + the engine.

**Use the engine from a handler.** Call
`loadEngineInput(prisma, exerciseId)` (`src/lib/engine-io.ts`) → `{ exercise,
revisions, logs }` already mapped to engine types, then `computeChain` /
`projectForward`. `exercise.day.program.startDate` + `exercise.day.weekday` give you
the calendar inputs (`isoDate(...)` from `src/lib/dates.ts` formats the date).

**Add/standardise an error.** Throw `NotFound`, `Conflict`, or `Unprocessable` from
`src/lib/http-errors.js`; the central handler (`src/plugins/errors.ts`) maps them.

**Add a model field.** Edit `prisma/schema.prisma`, then generate migration SQL
offline (no DB needed):
```bash
cd apps/api
pnpm exec prisma migrate diff \
  --from-schema-datamodel <prev> --to-schema-datamodel prisma/schema.prisma --script \
  > prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql
```
(For hand-written SQL like partial indexes, add a separate numbered migration folder.)
Then `pnpm exec prisma generate`. Update the relevant DTO in `serialize.ts` and, if the
field feeds the engine, `engine-io.ts`. Add/adjust tests.

**Respect the Decimal boundary.** Convert `Decimal`↔`number` only in `lib/decimal.ts`
/ `lib/engine-io.ts`. If a raw `Decimal` reaches a response, the serializer hook
throws loudly — fix the DTO, don't suppress it.

**Add a test.** Engine: a plain vitest file in `packages/engine/test/`. API: a file in
`apps/api/test/` using `makeApp()` and `app.inject(...)`. Assert through the public API,
not the DB, wherever possible.

---

## 11. Deployment (Railway)

1. Create a Railway project; add the **PostgreSQL** plugin.
2. Service from this repo, root `backend/`. Build:
   `pnpm install && pnpm --filter @wt/engine build && pnpm --filter @wt/api build`.
   Start: `pnpm --filter @wt/api start`.
3. Env (see `.env.example`): `DATABASE_URL` (reference the Postgres plugin), `PORT`,
   `HOST=0.0.0.0`, `API_KEY_ENABLED=false`.
4. Release step: `pnpm --filter @wt/api migrate:deploy` (`prisma migrate deploy`).

`pnpm -r build` builds in dependency order (engine before api). The API build also runs
`prisma generate`.
