import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeApp, type TestApp } from './helpers/app.js';

const START = '2026-01-05';
const TODAY = '2026-03-01';

describe('domain guards & invariants', () => {
  let t: TestApp;
  const inject = (method: 'POST' | 'PUT' | 'PATCH' | 'GET' | 'DELETE', url: string, payload?: unknown) =>
    t.app.inject({ method, url, ...(payload ? { payload } : {}) });

  async function setup() {
    const programId = (await inject('POST', '/programs', { name: 'P', startDate: START })).json().id;
    await inject('POST', `/programs/${programId}/activate`);
    const dayId = (await inject('POST', `/programs/${programId}/days`, { weekday: 0, order: 0 })).json().id;
    const exerciseId = (
      await inject('POST', `/days/${dayId}/exercises`, {
        name: 'Bench',
        order: 0,
        startWeightLb: 100,
        sets: 3,
        reps: 5,
        incrementLb: 5,
        roundingStepLb: 5,
      })
    ).json().id;
    return { programId, dayId, exerciseId };
  }

  beforeEach(async () => {
    t = await makeApp();
  });
  afterEach(async () => {
    await t.close();
  });

  it('rejects changing program startDate once logs exist (422)', async () => {
    const { programId, exerciseId } = await setup();
    await inject('PUT', `/exercises/${exerciseId}/logs/0?date=${TODAY}`, { status: 'done' });
    const res = await inject('PATCH', `/programs/${programId}`, { startDate: '2026-02-02' });
    expect(res.statusCode).toBe(422);
  });

  it('allows changing program startDate before any logs', async () => {
    const { programId } = await setup();
    const res = await inject('PATCH', `/programs/${programId}`, { startDate: '2026-01-12' });
    expect(res.statusCode).toBe(200);
    expect(res.json().startDate).toBe('2026-01-12');
  });

  it("rejects changing a day's weekday once logs exist (422)", async () => {
    const { dayId, exerciseId } = await setup();
    await inject('PUT', `/exercises/${exerciseId}/logs/0?date=${TODAY}`, { status: 'done' });
    const res = await inject('PATCH', `/days/${dayId}`, { weekday: 2 });
    expect(res.statusCode).toBe(422);
  });

  it('rejects logging a future occurrence (422)', async () => {
    const { exerciseId } = await setup();
    // "today" is the start date, so occurrence 5 is far in the future.
    const res = await inject('PUT', `/exercises/${exerciseId}/logs/5?date=${START}`, { status: 'done' });
    expect(res.statusCode).toBe(422);
  });

  it('rejects manualNextWeightLb with a done status (422)', async () => {
    const { exerciseId } = await setup();
    const res = await inject('PUT', `/exercises/${exerciseId}/logs/0?date=${TODAY}`, {
      status: 'done',
      manualNextWeightLb: 90,
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects a duplicate weekday within a program (409)', async () => {
    const { programId } = await setup();
    const res = await inject('POST', `/programs/${programId}/days`, { weekday: 0, order: 1 });
    expect(res.statusCode).toBe(409);
  });

  it('keeps exactly one active program across activations', async () => {
    const a = (await inject('POST', '/programs', { name: 'A', startDate: START })).json().id;
    const b = (await inject('POST', '/programs', { name: 'B', startDate: START })).json().id;
    await inject('POST', `/programs/${a}/activate`);
    await inject('POST', `/programs/${b}/activate`);
    const active = (await inject('GET', '/programs')).json().filter((p: { isActive: boolean }) => p.isActive);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(b);
  });

  it('is idempotent on repeated log writes (double-tap Done)', async () => {
    const { exerciseId } = await setup();
    const first = await inject('PUT', `/exercises/${exerciseId}/logs/0?date=${TODAY}`, { status: 'done' });
    const second = await inject('PUT', `/exercises/${exerciseId}/logs/0?date=${TODAY}`, { status: 'done' });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const history = (await inject('GET', '/views/history')).json().items;
    expect(history).toHaveLength(1);
  });

  it('reverts an occurrence to missed when its log is deleted', async () => {
    const { exerciseId } = await setup();
    await inject('PUT', `/exercises/${exerciseId}/logs/0?date=${TODAY}`, { status: 'done' });
    const del = await inject('DELETE', `/exercises/${exerciseId}/logs/0`);
    expect(del.statusCode).toBe(204);
    expect((await inject('GET', '/views/history')).json().items).toHaveLength(0);
  });

  it('surfaces a non-blocking warning for a drift-prone increment', async () => {
    const programId = (await inject('POST', '/programs', { name: 'W', startDate: START })).json().id;
    const dayId = (await inject('POST', `/programs/${programId}/days`, { weekday: 1, order: 0 })).json().id;
    const res = await inject('POST', `/days/${dayId}/exercises`, {
      name: 'OHP',
      order: 0,
      startWeightLb: 40,
      sets: 3,
      reps: 5,
      incrementLb: 2,
      roundingStepLb: 5,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().warnings.map((w: { code: string }) => w.code)).toContain(
      'increment_not_multiple_of_step',
    );
  });
});
