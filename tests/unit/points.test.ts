/* Unit — the point scale itself. */

import { describe, it, expect, afterEach } from 'vitest';
import { loadApp, type App } from './app.ts';

let app: App;
afterEach(() => app?.close());

describe('マシンのポイント', () => {
  it('U1: 0 以上 10 以下の整数しか出ない', async () => {
    app = await loadApp();
    for (let round = 0; round < 40; round++) {
      for (const m of app.machines()) {
        expect(Number.isInteger(m.pt), `pt=${m.pt} が整数でない`).toBe(true);
        expect(m.pt).toBeGreaterThanOrEqual(0);
        expect(m.pt).toBeLessThanOrEqual(10);
      }
      app.regenerate();
    }
  });

  it('U2: 十分に振ると 0 から 10 まで 11 種すべて出る', async () => {
    app = await loadApp();
    const seen = new Set<number>();
    for (let round = 0; round < 80 && seen.size < 11; round++) {
      app.machines().forEach((m) => seen.add(m.pt));
      app.regenerate();
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('U3: 必須マシンのポイントは必ず 10', async () => {
    app = await loadApp();
    let mustSeen = 0;
    for (let round = 0; round < 60; round++) {
      for (const m of app.machines().filter((x) => x.must)) {
        mustSeen++;
        expect(m.pt, '必須マシンなのに 10pt でない').toBe(10);
      }
      app.regenerate();
    }
    expect(mustSeen, '必須マシンが 1 台も出なかった').toBeGreaterThan(0);
  });

  it('U4: 必須でないマシンも 10pt になりうる（10pt が必須を意味しない）', async () => {
    app = await loadApp();
    let found = false;
    for (let round = 0; round < 80 && !found; round++) {
      found = app.machines().some((m) => !m.must && m.pt === 10);
      app.regenerate();
    }
    expect(found).toBe(true);
  });
});
