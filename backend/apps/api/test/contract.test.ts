import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dateForOccurrence } from '@wt/engine';
import { makeApp, type TestApp } from './helpers/app.js';

const START = '2026-01-05';
const TODAY = '2026-03-01';

/** Walk a payload, collecting every object key seen (with its dotted path). */
function collectKeys(value: unknown, path = '$', acc: Array<[string, string]> = []): Array<[string, string]> {
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectKeys(v, `${path}[${i}]`, acc));
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      acc.push([k, `${path}.${k}`]);
      collectKeys(v, `${path}.${k}`, acc);
    }
  }
  return acc;
}

// lb-only boundary: no endpoint may emit a `unit` field, and any weight-bearing
// field must name its unit (end in `Lb`).
describe('API contract — lb-only boundary', () => {
  let t: TestApp;
  const inject = (url: string) => t.app.inject({ method: 'GET', url });

  beforeAll(async () => {
    t = await makeApp();
    const i = (method: 'POST' | 'PUT', url: string, payload: unknown) => t.app.inject({ method, url, payload });
    const programId = (await i('POST', '/programs', { name: 'P', startDate: START })).json().id;
    await i('POST', `/programs/${programId}/activate`, {});
    const dayId = (await i('POST', `/programs/${programId}/days`, { weekday: 0, order: 0 })).json().id;
    const exerciseId = (
      await i('POST', `/days/${dayId}/exercises`, {
        name: 'Bench',
        order: 0,
        startWeightLb: 100,
        sets: 3,
        reps: 5,
        incrementLb: 5,
        roundingStepLb: 5,
      })
    ).json().id;
    await i('PUT', `/exercises/${exerciseId}/logs/0?date=${TODAY}`, { status: 'failed', manualNextWeightLb: 95 });
  });
  afterAll(async () => {
    await t.close();
  });

  it('no response contains a `unit` field, and weight fields end in Lb', async () => {
    const day1 = dateForOccurrence(START, 0, 1);
    const payloads = await Promise.all(
      [`/views/today?date=${day1}`, `/views/week?date=${day1}`, '/views/history', '/programs'].map((u) =>
        inject(u).then((r) => r.json()),
      ),
    );

    for (const payload of payloads) {
      for (const [key, path] of collectKeys(payload)) {
        expect(key.toLowerCase(), `unexpected unit field at ${path}`).not.toBe('unit');
        if (/weight/i.test(key)) {
          expect(key.endsWith('Lb'), `weight field "${key}" at ${path} must end in Lb`).toBe(true);
        }
      }
    }
  });
});
