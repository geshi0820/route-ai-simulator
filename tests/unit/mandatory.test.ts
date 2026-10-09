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

  it('U13: travel + work が total と一致する（必須マシンの時間が二重計上も抜けもしない）', async () => {
    app = await loadApp();
    for (let round = 0; round < 40; round++) {
      const best = app.read<any>('optimize()');
      if (best.order.length > 0) {
        // total を信じずに内訳から組み直す。used から forcedMin が抜けると、
        // total が過少申告になって `total <= budget` だけでは素通りする。
        expect(best.travel + best.work, 'travel + work が total と合わない').toBe(best.total);
        expect(best.travel + best.work, '実際に使う時間が working time を超えている')
          .toBeLessThanOrEqual(app.read<number>('dayBudget'));
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

describe('同じ点なら短いほうを選ぶ', () => {
  it('U14: 同点の選び方が複数あるとき、作業時間が最小のものを返す', async () => {
    app = await loadApp();
    /* 手で盤面を組む。A には 5pt の機械が 2 台あり、片方は 10 分、もう片方は 30 分。
       どちらを選んでも 5pt なので、最小時間を選ばない実装だと 30 分のほうを返しうる。 */
    app.window.eval(`
      NODES = [
        { id: 'home', kind: 'home', name: 'Home', x: 380, y: 500 },
        { id: 'A', kind: 'loc', name: 'A', x: 380, y: 440, must: true, machines: [
          { pt: 5, type: 1, must: false },   // 10 min
          { pt: 5, type: 0, must: false },   // 30 min
        ] },
      ];
      EDGES = [{ from: 'home', to: 'A', state: 'normal' }];
      dayBudget = 60;   // 往復 24 分。残り 36 分では 10 分か 30 分のどちらか 1 台しか入らない
    `);
    const best = app.read<any>('optimize()');
    expect(best.reward, '5pt が取れていない').toBe(5);
    expect(best.chosen).toHaveLength(1);
    expect(best.chosen[0].min, '同じ 5pt なのに長いほうを選んでいる').toBe(10);
    expect(best.work, 'work が最小の作業時間になっていない').toBe(10);
  });

  it('U15: 盤面を振っても、同じ点をより短く取れる選び方は残らない', async () => {
    app = await loadApp();
    let checked = 0;
    for (let round = 0; round < 60; round++) {
      const best = app.read<any>('optimize()');
      if (best.order.length > 0) {
        const cheaper = app.read<number>(`(() => {
          const best = optimize();
          const byId = Object.fromEntries(NODES.map(n => [n.id, n]));
          const items = []; let forcedMin = 0, forcedPt = 0;
          best.order.forEach(id => (byId[id].machines || []).forEach(m => {
            const min = (TYPES[m.type] || TYPES[0]).min;
            if (m.must) { forcedMin += min; forcedPt += m.pt; } else items.push({ pt: m.pt, min });
          }));
          if (items.length > 18) return -1;
          const bank = best.order.includes('bank') ? BANK_MIN : 0;
          const cap = dayBudget - best.travel - bank - forcedMin;
          let cheapest = Infinity;
          for (let mask = 0; mask < (1 << items.length); mask++) {
            let pt = forcedPt, min = 0;
            for (let i = 0; i < items.length; i++) if (mask & (1 << i)) { pt += items[i].pt; min += items[i].min; }
            if (min <= cap && pt === best.reward) cheapest = Math.min(cheapest, min + forcedMin);
          }
          return cheapest === Infinity ? -1 : (best.work - bank) - cheapest;
        })()`);
        if (cheaper >= 0) { checked++; expect(cheaper, '同じ点をもっと短く取れる').toBe(0); }
      }
      app.regenerate();
    }
    expect(checked, '総当たりで確かめられる盤面が 1 つも無かった').toBeGreaterThan(10);
  });
});
