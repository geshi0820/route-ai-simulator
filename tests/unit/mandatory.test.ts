/* Unit — what "mandatory" means, at both levels. */

import { describe, it, expect, afterEach } from 'vitest';
import { loadApp, workMinutes, type App, type Node } from './app.ts';

let app: App;
afterEach(() => app?.close());

describe('必須の判定（mustStop）', () => {
  it('U5: 人が指定した拠点は必須', async () => {
    app = await loadApp();
    const node = { kind: 'loc', must: true, machines: [{ pt: 1, type: 0, must: false }] };
    expect(app.read<boolean>(`mustStop(${JSON.stringify(node)})`)).toBe(true);
  });

  it('U6: 必須マシンを 1 台でも持つ拠点は、人が指定していなくても必須', async () => {
    app = await loadApp();
    const node = {
      kind: 'loc', must: false,
      machines: [{ pt: 3, type: 0, must: false }, { pt: 10, type: 1, must: true }],
    };
    expect(app.read<boolean>(`mustStop(${JSON.stringify(node)})`)).toBe(true);
  });

  it('U7: どちらでもない拠点は必須でない', async () => {
    app = await loadApp();
    const node = { kind: 'loc', must: false, machines: [{ pt: 3, type: 0, must: false }] };
    expect(app.read<boolean>(`mustStop(${JSON.stringify(node)})`)).toBe(false);
  });

  it('U8: 機械を持たない拠点（Bank）でも落ちない', async () => {
    app = await loadApp();
    expect(app.read<boolean>(`mustStop({ kind:'bank', must:false })`)).toBe(false);
    expect(app.read<boolean>(`mustStop({ kind:'bank', must:true })`)).toBe(true);
  });
});

describe('最適化が必須を守る（optimize）', () => {
  it('U9: 必須マシンは必ず選ばれ、その拠点は必ず訪問される', async () => {
    app = await loadApp();
    let checked = 0;
    for (let round = 0; round < 40; round++) {
      const best = app.read<any>('optimize()');
      if (best.order.length > 0) {
        const chosen = new Set(best.chosen.map((it: any) => it.ref));
        for (const n of app.nodes().filter((x) => x.kind === 'loc')) {
          for (const m of (n.machines ?? []).filter((x) => x.must)) {
            checked++;
            expect(chosen.has(m), '必須マシンが選ばれていない').toBe(true);
            expect(best.order, '必須マシンの拠点が訪問されていない').toContain(n.id);
          }
        }
      }
      app.regenerate();
    }
    expect(checked, '必須マシンが 1 台も出なかった').toBeGreaterThan(0);
  });

  it('U10: 0pt のマシンは選ばれない（時間だけ食って点にならない）', async () => {
    app = await loadApp();
    for (let round = 0; round < 40; round++) {
      const best = app.read<any>('optimize()');
      expect(best.chosen.filter((it: any) => it.pt === 0)).toHaveLength(0);
      app.regenerate();
    }
  });

  it('U11: reward は選ばれたマシンの pt 合計と一致する', async () => {
    app = await loadApp();
    for (let round = 0; round < 40; round++) {
      const best = app.read<any>('optimize()');
      if (best.order.length > 0) {
        const sum = best.chosen.reduce((a: number, it: any) => a + it.pt, 0);
        expect(sum).toBe(best.reward);
      }
      app.regenerate();
    }
  });

  it('U12: 必須マシンの作業時間は先に引かれ、合計は working time を超えない', async () => {
    app = await loadApp();
    for (let round = 0; round < 40; round++) {
      const best = app.read<any>('optimize()');
      const budget = app.read<number>('dayBudget');
      if (best.order.length > 0) {
        expect(best.total).toBeLessThanOrEqual(budget);
        const forced = app.nodes()
          .filter((n) => n.kind === 'loc' && best.order.includes(n.id))
          .flatMap((n) => (n.machines ?? []).filter((m) => m.must));
        const forcedMin = forced.reduce((a, m) => a + workMinutes(app, m), 0);
        expect(best.work, '必須マシンの作業時間が work に入っていない').toBeGreaterThanOrEqual(forcedMin);
      }
      app.regenerate();
    }
  });
});
