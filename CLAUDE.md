# Workout Tracker

## Project layout

- `frontend/` — frontend application code.
- `backend/` — backend application code.

## Backend reference

Before making backend changes — or building frontend features against the API —
read **`backend/BACKEND.md`**. It is the cold-start reference: architecture, the
progression engine, the data model, the full per-endpoint API reference (request/
response shapes), invariants, and recipes for common changes.

**Keep `backend/BACKEND.md` up to date.** Whenever you change backend behavior,
update it in the same change — e.g. adding/removing/altering an endpoint or its
request/response shape, changing the data model or migrations, the engine's
behavior, error/status conventions, or any invariant. The doc must always match the
running code so it stays trustworthy as the cold-start reference.

## Progress tracking

We keep a running record of what has been built and why:

- **`frontend_progress.md`** — completed frontend work and frontend decisions.
- **`backend_progress.md`** — completed backend work and backend decisions.

Update the relevant progress file whenever you finish a feature or make a
notable decision. Read it before starting work to see what already exists.

## Verifying that a feature works

A feature is only considered "working" once it has been verified. How we verify
depends on the side of the stack:

- **Backend** — verify with **unit tests** *and* **runtime verification
  testing** (run the app/endpoint and confirm the real behavior).
- **Frontend** — we do **not** write unit tests for the frontend. Verify with
  **runtime verification testing** only (run the app and confirm the behavior
  in the running UI).

Do not mark a feature complete in the progress files until it has passed the
verification appropriate to its side of the stack.
