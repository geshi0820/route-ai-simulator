/* Loads the real index.html in jsdom and hands back its top-level bindings.

   The app is one file with one inline classic <script>, so its functions are
   not exported anywhere. Rather than reshape the app to make it testable, the
   tests run the real page and read the real bindings: `window.eval` runs in
   global scope, where a classic script's top-level `const` and `function`
   declarations live. What the tests touch is therefore the shipped code. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const INDEX = resolve(dirname(fileURLToPath(import.meta.url)), '../../index.html');

export interface Machine { pt: number; type: number; must: boolean }
export interface Node {
  id: string; kind: 'home' | 'bank' | 'loc'; name: string;
  x: number; y: number; must?: boolean; machines?: Machine[];
}

export interface App {
  window: any;
  /** Evaluate an expression against the page's own global scope. */
  read<T = unknown>(expression: string): T;
  nodes(): Node[];
  machines(): Machine[];
  regenerate(): void;
  showAnswer(): void;
  close(): void;
}

export function loadApp(): Promise<App> {
  const dom = new JSDOM(readFileSync(INDEX, 'utf8'), {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
  const w = dom.window as any;
  return new Promise<App>((done) => {
    w.addEventListener('load', () => {
      const read = <T>(expression: string): T => w.eval(expression) as T;
      done({
        window: w,
        read,
        nodes: () => read<Node[]>('NODES'),
        machines: () => read<Node[]>('NODES')
          .filter((n) => n.kind === 'loc')
          .flatMap((n) => n.machines ?? []),
        regenerate: () => w.document.getElementById('reroll').click(),
        showAnswer: () => {
          if (!read<boolean>('showAnswer')) w.document.getElementById('reveal').click();
        },
        close: () => w.close(),
      });
    }, { once: true });
  });
}

/** The work time a machine costs, from the app's own type table. */
export function workMinutes(app: App, m: Machine): number {
  const types = app.read<{ min: number }[]>('TYPES');
  return (types[m.type] ?? types[0]).min;
}
