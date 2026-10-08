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
  expect(await page.locator('#reveal')).toHaveText(/Show answer/);
  const rings = await ringsByColour(page);
  expect(rings.must, '紫の輪の数が必須マシンの数と合わない').toBe(want);
  expect(rings.accent, '答えを出す前なのに青い輪が出ている').toBe(0);
});

test('E3: 答えを出すと選ばれた機械に青い輪が付き、必須マシンは紫のまま', async ({ page }) => {
  const want = await boardWithMandatory(page, 1);
  await page.click('#reveal');
  const rings = await ringsByColour(page);
  expect(rings.must, '必須マシンの輪が青に変わった').toBe(want);
  expect(rings.accent, '選ばれた機械に青い輪が付いていない').toBeGreaterThan(0);
});

test('E4: 必須マシンを持つ拠点は自動で紫になり、その mandatory トグルは ON 固定で淡い', async ({ page }) => {
  await boardWithMandatory(page, 1);
  const r = await page.evaluate(() => {
    const out = { forced: 0, purple: 0, checked: 0, disabled: 0, dimmed: 0, freeDimmed: 0 };
    NODES.filter((n: any) => n.kind === 'loc').forEach((n: any) => {
      const forced = n.machines.some((m: any) => m.must);
      const g = document.querySelector(`#board-a svg g[data-node="${n.id}"] circle`);
      const box = document.querySelector(`input[data-must="${n.id}"]`) as HTMLInputElement;
      const dim = Number(getComputedStyle(box.closest('.miniswitch')!).opacity) < 0.6;
      if (forced) {
        out.forced++;
        if ((g?.getAttribute('stroke') ?? '').includes('--must')) out.purple++;
        if (box.checked) out.checked++;
        if (box.disabled) out.disabled++;
        if (dim) out.dimmed++;
      } else if (dim) out.freeDimmed++;
    });
    return out;
  });
  expect(r.forced).toBeGreaterThan(0);
  expect(r.purple, '必須マシンを持つ拠点が紫になっていない').toBe(r.forced);
  expect(r.checked, 'トグルが ON になっていない').toBe(r.forced);
  expect(r.disabled, 'トグルが触れてしまう').toBe(r.forced);
  expect(r.dimmed, 'トグルが淡くなっていない').toBe(r.forced);
  expect(r.freeDimmed, '人が切り替えられるトグルまで淡くなっている').toBe(0);
});

test('E5: Points KPI は選ばれた機械の pt 合計と一致し、mandatory の数は紫の拠点数と一致する', async ({ page }) => {
  for (let round = 0; round < 15; round++) {
    await page.click('#reroll');
    if (!(await page.evaluate(() => showAnswer))) await page.click('#reveal');
    const r = await page.evaluate(() => {
      const best = optimize();
      const text = document.getElementById('kpis')!.innerText;
      return {
        sum: best.chosen.reduce((a: number, it: any) => a + it.pt, 0),
        reward: best.order.length > 0 ? best.reward : 0,
        shown: Number(/mandatory (\d+)/.exec(text)?.[1] ?? -1),
        purple: NODES.filter((n: any) => n.kind === 'loc' && mustStop(n)).length,
      };
    });
    expect(r.sum).toBe(r.reward);
    expect(r.shown, 'KPI の mandatory が紫の拠点数と合わない').toBe(r.purple);
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

  const pts = await logic.locator('td.pts').allTextContents();
  expect(pts).toEqual(['4', '4', '10', '10', '2', '—']);

  // 3・4 の点は紫（必須の色）、1・2・5 は青（積み上げの色）
  const colours = await logic.locator('td.pts').evaluateAll((tds) =>
    tds.map((td) => td.classList.contains('must')));
  expect(colours).toEqual([false, false, true, true, false, false]);
});

test('E8: 凡例に必須マシンの行があり、説明文が 0〜10 と紫の輪に触れている', async ({ page }) => {
  await expect(page.locator('.legend')).toContainText('Mandatory machine (always 10pt)');
  await expect(page.locator('.legend')).toContainText('Selected machine');
  const machineNote = page.locator('.note', { hasText: 'The small circles inside a location' });
  await expect(machineNote).toContainText('number = points (0–10)');
  await expect(machineNote).toContainText('purple ring = must be serviced');
});
