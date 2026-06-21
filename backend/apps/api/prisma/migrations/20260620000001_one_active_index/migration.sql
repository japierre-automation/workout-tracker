-- Enforce "at most one active program" at the database level. Prisma cannot express
-- a partial unique index, so it lives here as hand-written SQL. The constant-true
-- expression means the index has a single possible key, so a second row with
-- isActive = true violates uniqueness.
CREATE UNIQUE INDEX "one_active_program" ON "Program" ((true)) WHERE "isActive";
