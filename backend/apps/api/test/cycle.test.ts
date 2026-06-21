import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, dateForOccurrence } from '@wt/engine';
import { makeApp, type TestApp } from './helpers/app.js';

// Spec §4.2 simulated training cycle, driven entirely through the public API.
// Program starts on a known Monday; one Monday day; one Bench exercise.
const START = '2026-01-05'; // Monday
const WEEKDAY = 0;
const TODAY = '2026-03-01'; // well past week 6, so all of weeks 0–5 are backfillable

describe('simulated training cycle (spec §4.2)', () => {
  let t: TestApp;
  let programId: string;
  let exerciseId: string;

  const inject = (method: 'POST' | 'PUT' | 'PATCH' | 'GET' | 'DELETE', url: string, payload?: unknown) =>
    t.app.inject({ method, url, ...(payload ? { payload } : {}) });

  // Query the week containing occurrence `k`. `asOf` is the "today" the view marks
  // statuses against; it defaults to the occurrence's own date.
  const weekCell = async (occurrenceIndex: number, asOf?: string) => {
    const date = asOf ?? dateForOccurrence(START, WEEKDAY, occurrenceIndex);
    const res = await inject('GET', `/views/week?date=${date}`);
    const cell = res.json().days[0].exercises[0];
    return { weightLb: cell.prescribedWeightLb, dateStatus: cell.dateStatus, log: cell.log };
  };
  const weekCellWeight = async (occurrenceIndex: number) =>
    (await weekCell(occurrenceIndex)).weightLb;

  beforeAll(async () => {
    t = await makeApp();

    const prog = await inject('POST', '/programs', { name: 'PPL', startDate: START });
    expect(prog.statusCode).toBe(201);
    programId = prog.json().id;

    await inject('POST', `/programs/${programId}/activate`);

    const day = await inject('POST', `/programs/${programId}/days`, { weekday: WEEKDAY, order: 0 });
    expect(day.statusCode).toBe(201);
    const dayId = day.json().id;

    const ex = await inject('POST', `/days/${dayId}/exercises`, {
      name: 'Bench Press',
      order: 0,
      startWeightLb: 135,
      sets: 3,
      reps: 5,
      incrementLb: 5,
      roundingStepLb: 5,
      failureMultiplier: 0.9,
    });
    expect(ex.statusCode).toBe(201);
    expect(ex.json().warnings).toEqual([]);
    exerciseId = ex.json().id;
  });

  afterAll(async () => {
    await t.close();
  });

  it('logs done, done, failed, done and leaves week 5 missed', async () => {
    const log = (k: number, status: 'done' | 'failed') =>
      inject('PUT', `/exercises/${exerciseId}/logs/${k}?date=${TODAY}`, { status });

    expect((await log(0, 'done')).statusCode).toBe(200);
    expect((await log(1, 'done')).statusCode).toBe(200);

    const failed = await log(2, 'failed');
    expect(failed.statusCode).toBe(200);
    // The failed occurrence was prescribed 145; next drops to 0.9*145 -> 130.
    expect(failed.json().log.prescribedWeightLb).toBe(145);
    expect(failed.json().nextOccurrence.weightLb).toBe(130);

    expect((await log(3, 'done')).statusCode).toBe(200);
    // index 4 deliberately left unlogged (missed)
  });

  it('reproduces the prescribed sequence [135,140,145,130,135,140]', async () => {
    expect(await weekCellWeight(0)).toBe(135);
    expect(await weekCellWeight(1)).toBe(140);
    expect(await weekCellWeight(2)).toBe(145);
    expect(await weekCellWeight(3)).toBe(130);

    // Inspect week 5 (index 4) as of a later day in that same week: unlogged + past = missed.
    const asOf = addDays(dateForOccurrence(START, WEEKDAY, 4), 2);
    const missed = await weekCell(4, asOf);
    expect(missed.weightLb).toBe(135);
    expect(missed.dateStatus).toBe('missed');
    expect(missed.log).toBeNull();

    expect(await weekCellWeight(5)).toBe(140);
  });

  it('shows only actually-logged sessions in history, newest first', async () => {
    const res = await inject('GET', '/views/history');
    const items = res.json().items;
    expect(items).toHaveLength(4);
    expect(items.map((i: { occurrenceIndex: number }) => i.occurrenceIndex)).toEqual([3, 2, 1, 0]);
    expect(items[1].status).toBe('failed'); // occurrence 2
    expect(items[0].exercise.name).toBe('Bench Press');
  });

  it('applies a forward-only increment edit without touching history', async () => {
    // lastLogged = 3, so the new revision takes effect at index 4.
    const patch = await inject('PATCH', `/exercises/${exerciseId}`, { incrementLb: 10 });
    expect(patch.statusCode).toBe(200);

    // History before the boundary is unchanged.
    expect(await weekCellWeight(3)).toBe(130);
    // index 4 reseeds at the carried-forward weight (135) ...
    expect(await weekCellWeight(4)).toBe(135);
    // ... and index 5 now climbs by the new increment of 10 -> 145.
    expect(await weekCellWeight(5)).toBe(145);
  });

  it('today view resolves the active program and current occurrence', async () => {
    const res = await inject('GET', `/views/today?date=${dateForOccurrence(START, WEEKDAY, 1)}`);
    const body = res.json();
    expect(body.program.name).toBe('PPL');
    expect(body.day.exercises[0].occurrenceIndex).toBe(1);
    expect(body.day.exercises[0].prescribedWeightLb).toBe(140);
    expect(body.day.exercises[0].log.status).toBe('done');
  });
});
