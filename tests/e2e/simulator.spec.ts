/* E2E — what a person actually sees in the browser. The app is one static
   file, so every test opens it over file:// and drives the real controls. */

import { test, expect, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const INDEX = pathToFileURL(resolve(import.meta.dirname, '../../index.html')).href;

/** Regenerate until the board holds at least `want` mandatory machines. */
async function boardWithMandatory(page: Page, want = 1) {
  for (let i = 0; i < 120; i++) {
    const n = await page.evaluate(() =>
      NODES.filter((x: any) => x.kind === 'loc')
        .reduce((a: number, x: any) => a + x.machines.filter((m: any) => m.must).length, 0));
    if (n >= want) return n;
    await page.click('#reroll');
  }
  throw new Error(`mandatory machines never reached ${want}`);
}

/** Regenerate until `want` distinct locations are forced mandatory by a machine. */
async function stopsForcedByMachine(page: Page, want: number) {
  for (let i = 0; i < 160; i++) {
    const ids = await page.evaluate(() =>
      NODES.filter((n: any) => n.kind === 'loc' && n.machines.some((m: any) => m.must))
        .map((n: any) => n.id));
    if (ids.length >= want) return ids as string[];
    await page.click('#reroll');
  }
  throw new Error(`never reached ${want} stops forced by a machine`);
}

/** Regenerate until the board has mandatory machines *and* the optimum picks a
    non-mandatory one too. A blue ring only ever marks a non-forced pick, so a
    board where every pick is forced — or that is infeasible — has none to find. */
async function boardWithBothRings(page: Page) {
  for (let i = 0; i < 120; i++) {
    const r = await page.evaluate(() => {
      const must = NODES.filter((x: any) => x.kind === 'loc')
        .reduce((a: number, x: any) => a + x.machines.filter((m: any) => m.must).length, 0);
      const best = optimize();
      const free = best.order.length === 0
        ? 0
        : best.chosen.filter((it: any) => !it.ref.must).length;
      return { must, free };
    });
    if (r.must >= 1 && r.free >= 1) return r.must;
    await page.click('#reroll');
  }
  throw new Error('no board with both a mandatory machine and a non-mandatory pick');
}

/** The rings drawn around machine circles, by stroke colour. */
function ringsByColour(page: Page) {
  return page.evaluate(() => {
    const out: Record<string, number> = { must: 0, accent: 0 };
    document.querySelectorAll('#board-a svg circle[fill="none"]').forEach((c) => {
      const s = c.getAttribute('stroke') ?? '';
      if (s.includes('--must')) out.must++;
      else if (s.includes('--accent')) out.accent++;
    });
    return out;
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto(INDEX);
  await page.waitForSelector('#board-a svg');
});

test('E1: 機械の丸に 0〜10 の数字だけが出て、2 桁も円からはみ出さない', async ({ page }) => {
  const seen = new Set<number>();
  for (let round = 0; round < 40; round++) {
    const r = await page.evaluate(() => {
      const nums: number[] = [];
      let overflow = 0;
      document.querySelectorAll('#board-a svg text').forEach((t) => {
        if (t.getAttribute('font-size') !== '9') return;
        nums.push(Number(t.textContent));
        const bb = (t as SVGTextElement).getBBox();
        const cx = Number(t.getAttribute('x')), cy = Number(t.getAttribute('y'));
        const half = bb.height * 0.36;
        const corners = [
          [bb.x, cy - half], [bb.x + bb.width, cy - half],
          [bb.x, cy + half], [bb.x + bb.width, cy + half],
        ];
        const far = Math.max(...corners.map(([x, y]) => Math.hypot(x - cx, y - cy)));
        if (far > 8) overflow++;          // 8 = the machine circle's radius
      });
      return { nums, overflow };
    });
    expect(r.overflow, '数字が機械の円からはみ出している').toBe(0);
    r.nums.forEach((n) => {
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(10);
      seen.add(n);
    });
    await page.click('#reroll');
  }
  expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('E2: 必須マシンには紫の輪が付き、答えを出す前から見えている', async ({ page }) => {
  const want = await boardWithMandatory(page, 1);
  await expect(page.locator('#reveal')).toHaveText(/Show answer/);
  const rings = await ringsByColour(page);
  expect(rings.must, '紫の輪の数が必須マシンの数と合わない').toBe(want);
  expect(rings.accent, '答えを出す前なのに青い輪が出ている').toBe(0);
});

test('E3: 答えを出すと選ばれた機械に青い輪が付き、必須マシンは紫のまま', async ({ page }) => {
  const want = await boardWithBothRings(page);
  await page.click('#reveal');
  const rings = await ringsByColour(page);
  expect(rings.must, '必須マシンの輪が青に変わった').toBe(want);
  expect(rings.accent, '選ばれた機械に青い輪が付いていない').toBeGreaterThan(0);
});

test('E4: 必須マシンを持つ拠点は自動で紫になり、機械だけが必須にしている間はトグルが ON 固定で淡い', async ({ page }) => {
  // 機械が必須にしている拠点が 2 つ以上ある盤面にして、そのうち 1 つだけ人も mandatory を付ける。
  // 2 つ必要なのは、「人が付けていない側はロックされる」を空振りさせないため。
  const forcedIds = await stopsForcedByMachine(page, 2);
  await page.evaluate((id) => {
    // スライダーが既に別の拠点を mandatory にしていることがあるので、まず人の指定を揃える
    NODES.filter((n: any) => n.kind === 'loc').forEach((n: any) => { n.must = n.id === id; });
    render();
  }, forcedIds[0]);
  const r = await page.evaluate(() => {
    const out = { byMachine: 0, purple: 0, checked: 0, locked: 0, dimmed: 0, mine: 0, mineLocked: 0, freeDimmed: 0 };
    NODES.filter((n: any) => n.kind === 'loc').forEach((n: any) => {
      const byMachine = n.machines.some((m: any) => m.must);
      const g = document.querySelector(`#board-a svg g[data-node="${n.id}"] circle`);
      const box = document.querySelector(`input[data-must="${n.id}"]`) as HTMLInputElement;
      const dim = Number(getComputedStyle(box.closest('.miniswitch')!).opacity) < 0.6;
      if (byMachine) {
        out.byMachine++;
        if ((g?.getAttribute('stroke') ?? '').includes('--must')) out.purple++;
        if (box.checked) out.checked++;
        if (n.must) { out.mine++; if (box.disabled) out.mineLocked++; }
        else { if (box.disabled) out.locked++; if (dim) out.dimmed++; }
      } else if (dim) out.freeDimmed++;
    });
    return out;
  });
  expect(r.byMachine).toBeGreaterThan(0);
  expect(r.purple, '必須マシンを持つ拠点が紫になっていない').toBe(r.byMachine);
  expect(r.checked, 'トグルが ON になっていない').toBe(r.byMachine);
  // 機械だけが必須にしている間は、人のものではないので触れない
  expect(r.locked, '機械が必須にしている拠点のトグルが触れてしまう').toBe(r.byMachine - r.mine);
  expect(r.dimmed, 'そのトグルが淡くなっていない').toBe(r.byMachine - r.mine);
  // 人が自分で付けた分は、機械が必須にしていても外せる（閉じ込めない）
  expect(r.mine, '人が付けた状態を作れていない').toBeGreaterThan(0);
  expect(r.byMachine - r.mine, 'ロックされる側が 1 件も無い盤面で検証している').toBeGreaterThan(0);
  expect(r.mineLocked, '人が自分で付けた mandatory が外せなくなっている').toBe(0);
  expect(r.freeDimmed, '人が切り替えられるトグルまで淡くなっている').toBe(0);
});

test('E5: Points KPI は選ばれた機械の pt 合計と一致し、mandatory の数は紫の拠点数と一致する', async ({ page }) => {
  for (let round = 0; round < 15; round++) {
    await page.click('#reroll');
    if (!(await page.evaluate(() => showAnswer))) await page.click('#reveal');
    const r = await page.evaluate(() => {
      const best = optimize();
      const text = document.getElementById('kpis')!.innerText;
      const m = /(\d+) chosen \+ (\d+) must-service/.exec(text);
      const rings = [...document.querySelectorAll('#board-a svg circle[fill="none"]')];
      return {
        sum: best.chosen.reduce((a: number, it: any) => a + it.pt, 0),
        reward: best.order.length > 0 ? best.reward : 0,
        shown: Number(/mandatory (\d+)/.exec(text)?.[1] ?? -1),
        purple: NODES.filter((n: any) => n.kind === 'loc' && mustStop(n)).length,
        kpi: m ? { chosen: Number(m[1]), forced: Number(m[2]) } : null,
        blue: rings.filter((c) => (c.getAttribute('stroke') ?? '').includes('--accent')).length,
        forcedChosen: best.chosen.filter((it: any) => it.ref.must).length,
      };
    });
    expect(r.sum).toBe(r.reward);
    expect(r.shown, 'KPI の mandatory が紫の拠点数と合わない').toBe(r.purple);
    // 内訳が青い輪の数と突き合うこと。1 つの合計だと盤面と照合できない
    expect(r.kpi, 'Points KPI に chosen / must-service の内訳が出ていない').not.toBeNull();
    expect(r.kpi!.chosen, '青い輪の数と KPI の chosen が合わない').toBe(r.blue);
    expect(r.kpi!.forced, '紫の輪の数と KPI の must-service が合わない').toBe(r.forcedChosen);
  }
});

test('E6: 必須が working time に収まらない盤面では、その旨が出て route は空になる', async ({ page }) => {
  // 作業時間を最小にすれば、必須だけで必ず溢れる盤面を作れる
  await page.evaluate(() => {
    const el = document.getElementById('budget') as HTMLInputElement;
    el.value = el.min; el.dispatchEvent(new Event('input'));
  });
  await boardWithMandatory(page, 1);
  if (!(await page.evaluate(() => showAnswer))) await page.click('#reveal');
  const r = await page.evaluate(() => ({
    order: optimize().order.length,
    route: document.getElementById('route')!.innerText,
  }));
  expect(r.order).toBe(0);
  expect(r.route).toMatch(/mandatory stops and machines/);
});

test('E7: Scoring Logic タブが 0–10pt 表記で、3・4 が必須の出どころになっている', async ({ page }) => {
  await page.click('.tab[data-tab="logic"]');
  const logic = page.locator('#tab-logic');
  await expect(page.locator('.tab[data-tab="logic"]')).toHaveText(/0–10pt/);
  await expect(logic).toContainText('Rules for Assigning 0–10pt');
  await expect(logic.locator('thead')).toContainText('Points');
  await expect(logic).not.toContainText('3pt');

  // 1・2・5 は範囲。範囲でないと 0〜10 のうち奇数が表で説明できなくなる
  const pts = await logic.locator('td.pts').allTextContents();
  expect(pts).toEqual(['0–4', '0–4', '10', '10', '0–2', '—']);

  // 3・4 の点は紫（必須の色）、1・2・5 は青（積み上げの色）
  const colours = await logic.locator('td.pts').evaluateAll((tds) =>
    tds.map((td) => td.classList.contains('must')));
  expect(colours).toEqual([false, false, true, true, false, false]);
});

test('E8: 凡例に必須マシンの行があり、説明文が 0〜10 と紫の輪に触れている', async ({ page }) => {
  await expect(page.locator('.legend')).toContainText('Must-service machine (pinned to 10pt)');
  await expect(page.locator('.legend')).toContainText('Selected machine');
  const machineNote = page.locator('.note', { hasText: 'The small circles inside a location' });
  await expect(machineNote).toContainText('number = points (0–10)');
  await expect(machineNote).toContainText('purple ring = must be serviced');
});

test('E9: Must-service machines を 0 にすると、必須マシンも機械由来の紫の拠点も消える', async ({ page }) => {
  await page.evaluate(() => {
    const el = document.getElementById('mustMachines') as HTMLInputElement;
    el.value = '0'; el.dispatchEvent(new Event('input'));
  });
  for (let round = 0; round < 25; round++) {
    const r = await page.evaluate(() => ({
      must: NODES.filter((n: any) => n.kind === 'loc')
        .reduce((a: number, n: any) => a + n.machines.filter((m: any) => m.must).length, 0),
      forced: NODES.filter((n: any) => n.kind === 'loc' && machineMust(n)).length,
    }));
    expect(r.must, 'スライダー 0 なのに必須マシンが出ている').toBe(0);
    expect(r.forced, '機械由来の紫の拠点が残っている').toBe(0);
    await page.click('#reroll');
  }
});

test('E10: Must-service machines の本数が、そのまま盤面の必須マシンの数になる', async ({ page }) => {
  for (const want of [0, 1, 3, 6]) {
    await page.evaluate((v) => {
      const el = document.getElementById('mustMachines') as HTMLInputElement;
      el.value = String(v); el.dispatchEvent(new Event('input'));
    }, want);
    const r = await page.evaluate(() => {
      const ms = NODES.filter((n: any) => n.kind === 'loc').flatMap((n: any) => n.machines);
      return { must: ms.filter((m: any) => m.must).length, total: ms.length,
               notTen: ms.filter((m: any) => m.must && m.pt !== 10).length };
    });
    expect(r.must, `${want} を指定したのに必須マシンが ${r.must} 台`).toBe(Math.min(want, r.total));
    expect(r.notTen, '必須マシンが 10pt でない').toBe(0);
  }
});

test('E11: Working time は、同じ点を取れる最小の時間になっている', async ({ page }) => {
  for (let round = 0; round < 12; round++) {
    await page.click('#reroll');
    if (!(await page.evaluate(() => showAnswer))) await page.click('#reveal');
    const worse = await page.evaluate(() => {
      const best = optimize();
      if (best.order.length === 0) return 0;
      // 同じ順路・同じ点数で、より短く済む機械の選び方があるか総当たりで探す
      const byId = Object.fromEntries(NODES.map((n: any) => [n.id, n]));
      const items: any[] = [];
      let forcedMin = 0, forcedPt = 0;
      best.order.forEach((id: string) => (byId[id].machines || []).forEach((m: any) => {
        const min = (TYPES[m.type] || TYPES[0]).min;
        if (m.must) { forcedMin += min; forcedPt += m.pt; } else items.push({ pt: m.pt, min });
      }));
      if (items.length > 20) return 0;            // 総当たりが重すぎる盤面は飛ばす
      const cap = dayBudget - best.travel - (best.order.includes('bank') ? BANK_MIN : 0) - forcedMin;
      let cheapest = Infinity;
      for (let mask = 0; mask < (1 << items.length); mask++) {
        let pt = forcedPt, min = 0;
        for (let i = 0; i < items.length; i++) if (mask & (1 << i)) { pt += items[i].pt; min += items[i].min; }
        if (min <= cap && pt === best.reward) cheapest = Math.min(cheapest, min + forcedMin);
      }
      return cheapest === Infinity ? 0 : best.work - (best.order.includes('bank') ? BANK_MIN : 0) - cheapest;
    });
    expect(worse, '同じ点をもっと短い作業時間で取れる').toBeLessThanOrEqual(0);
  }
});

test('E12: Must-service machines を動かしても、必須でない機械の点は変わらない', async ({ page }) => {
  const snap = () => page.evaluate(() =>
    NODES.filter((n: any) => n.kind === 'loc')
      .flatMap((n: any) => n.machines.map((m: any) => ({ base: m.base, pt: m.pt, must: m.must }))));
  const before = await snap();
  for (const v of [5, 0, 8, 2]) {
    await page.evaluate((x) => {
      const el = document.getElementById('mustMachines') as HTMLInputElement;
      el.value = String(x); el.dispatchEvent(new Event('input'));
    }, v);
    const after = await snap();
    expect(after).toHaveLength(before.length);
    after.forEach((m, i) => {
      expect(m.base, '機械の素点が書き換わっている').toBe(before[i].base);
      // 必須なら 10 に固定、そうでなければ素点そのまま
      expect(m.pt, m.must ? '必須なのに 10pt でない' : 'スライダーで必須でない機械の点が変わった')
        .toBe(m.must ? 10 : m.base);
    });
  }
});

test('E13: 機械を ＋ − しても、必須マシンの本数がスライダーの表示と食い違わない', async ({ page }) => {
  await page.evaluate(() => {
    const el = document.getElementById('mustMachines') as HTMLInputElement;
    el.value = '2'; el.dispatchEvent(new Event('input'));
  });
  // 必須マシンを末尾に寄せてから − を押す。− は末尾を落とすので、必須が巻き添えになる経路
  const id = await page.evaluate(() => {
    const n = NODES.find((x: any) => x.kind === 'loc' && x.machines.some((m: any) => m.must));
    if (!n) return null;
    const i = n.machines.findIndex((m: any) => m.must);
    n.machines.push(n.machines.splice(i, 1)[0]);
    render();
    return n.id;
  });
  expect(id, '必須マシンを持つ拠点が見つからない').not.toBeNull();
  for (const d of ['-1', '1', '-1', '-1', '1']) {
    await page.click(`button[data-m="${id}"][data-d="${d}"]`);
    const r = await page.evaluate(() => ({
      shown: Number((document.getElementById('mustMVal') as HTMLElement).textContent),
      slider: Number((document.getElementById('mustMachines') as HTMLInputElement).value),
      actual: NODES.filter((n: any) => n.kind === 'loc')
        .reduce((a: number, n: any) => a + n.machines.filter((m: any) => m.must).length, 0),
    }));
    expect(r.actual, `表示 ${r.shown} に対し盤面の必須マシンは ${r.actual} 台`).toBe(r.shown);
    expect(r.slider, 'スライダーの値と表示が食い違う').toBe(r.shown);
  }
});

test('E14: 盤面にある機械より多い本数を指定しても、表示が実際の数に揃う', async ({ page }) => {
  await page.evaluate(() => {
    const ln = document.getElementById('locN') as HTMLInputElement;
    ln.value = '3'; ln.dispatchEvent(new Event('input'));
    NODES.filter((n: any) => n.kind === 'loc').forEach((n: any) => { n.machines = n.machines.slice(0, 1); });
    const el = document.getElementById('mustMachines') as HTMLInputElement;
    el.value = '12'; el.dispatchEvent(new Event('input'));
  });
  const r = await page.evaluate(() => ({
    shown: Number((document.getElementById('mustMVal') as HTMLElement).textContent),
    total: NODES.filter((n: any) => n.kind === 'loc').flatMap((n: any) => n.machines).length,
    actual: NODES.filter((n: any) => n.kind === 'loc')
      .flatMap((n: any) => n.machines).filter((m: any) => m.must).length,
  }));
  expect(r.shown, '機械の数より多い本数を表示している').toBe(r.total);
  expect(r.actual).toBe(r.total);
});
