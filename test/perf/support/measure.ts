import os from 'node:os';
import type { Page } from '@playwright/test';

/** One event as measured: to the second frame after it, its longest task, and what it did to the rows. */
export interface Sample {
  label: string;
  /** From the act to the second animation frame after it, ms. */
  frame: number;
  /** The longest stretch the main thread gave no turn to a message posted beside the act, ms: the longest task, its script and its rendering, wherever it was scheduled. */
  longest: number;
  rowsBefore: number;
  rowsAfter: number;
  /** Rows the event built rather than found already made. */
  built: number;
}

/** What the window is made to do, from inside the page. */
export type Act =
  | { kind: 'type'; text: string }
  | { kind: 'status'; id: string; busy: boolean }
  | { kind: 'burst'; ids: string[] }
  | { kind: 'rename'; title: string };

interface Measurer {
  measure(label: string, act: Act): Promise<Sample>;
  longestOver(ms: number): Promise<number>;
}

declare global {
  interface Window {
    __perf: Measurer;
  }
}

/**
 * The measuring, put in the page once it is loaded.
 * Handed to `page.evaluate` as a function, since the window's content security policy refuses code built from a string.
 */
function install(): void {
  const frame = (): Promise<number> => new Promise((done) => requestAnimationFrame(done));
  const rows = (): Element[] => [...document.querySelectorAll('#sessions .session')];
  const seen = new WeakSet<Element>(rows());

  /** Answers the longest gap between turns of a message loop, from now until `until` settles. */
  async function probe(until: Promise<unknown>): Promise<number> {
    const channel = new MessageChannel();
    let last = performance.now();
    let longest = 0;
    let running = true;
    channel.port1.onmessage = () => {
      const now = performance.now();
      longest = Math.max(longest, now - last);
      last = now;
      if (running) channel.port2.postMessage(0);
    };
    channel.port2.postMessage(0);
    await until;
    running = false;
    channel.port1.close();
    return Math.max(longest, performance.now() - last);
  }

  function act(what: Act): Promise<void> | void {
    const control = window.__claudeUiTest;
    switch (what.kind) {
      case 'type': {
        const input = document.getElementById('search') as HTMLInputElement;
        input.value = what.text;
        input.dispatchEvent(new Event('input'));
        return;
      }
      case 'status':
        control.emit('onSessionStatus', what.id, what.busy ? 'busy' : 'idle', '', what.busy ? 'UserPromptSubmit' : 'Stop', undefined, 'go on');
        return;
      case 'burst':
        what.ids.forEach((id, i) => control.emit('onSessionStatus', id, i % 2 ? 'idle' : 'busy', '', i % 2 ? 'Stop' : 'UserPromptSubmit', undefined, 'go on'));
        return;
      case 'rename': {
        // The list's first row, which is in sight: a row out of sight is brought up to date only once it comes into sight, so it would never say the new title here.
        const id = document.querySelector<HTMLElement>('#sessions .session')?.dataset.key ?? '';
        const fixture = window.__claudeUiFixture;
        fixture.sessions = fixture.sessions.map((s) => (s.id === id ? { ...s, title: what.title } : s));
        control.emit('onSessionsChanged');
        // Main's answer comes behind a promise: the event is drawn once its row says the new title.
        return (async () => {
          const deadline = performance.now() + 10_000;
          while (!document.querySelector(`#sessions [data-key="${id}"]`)?.textContent.includes(what.title)) {
            if (performance.now() > deadline) throw new Error(`The row of ${id} never said "${what.title}".`);
            await frame();
          }
        })();
      }
    }
  }

  window.__perf = {
    async measure(label, what) {
      await frame();
      await frame();
      const before = new Set(rows());
      const t0 = performance.now();
      const done = (async () => {
        await act(what);
        await frame();
        await frame();
      })();
      const longest = await probe(done);
      const elapsed = performance.now() - t0;
      const after = rows();
      const built = after.filter((row) => !seen.has(row)).length;
      for (const row of after) seen.add(row);
      return { label, frame: elapsed, longest, rowsBefore: before.size, rowsAfter: after.length, built };
    },
    longestOver: (ms) => probe(new Promise((done) => setTimeout(done, ms))),
  };
}

/** Put the measuring in the loaded page, and slow its CPU `throttle` times over. */
export async function prepare(page: Page, throttle: number): Promise<void> {
  await page.evaluate(install);
  if (throttle > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }
}

export function measure(page: Page, label: string, act: Act): Promise<Sample> {
  return page.evaluate(([l, a]) => window.__perf.measure(l, a), [label, act] as const);
}

/** The longest task in the next `ms`, for work on a timer of the window's own, such as the minute's tick. */
export function longestOver(page: Page, ms: number): Promise<number> {
  return page.evaluate((wait) => window.__perf.longestOver(wait), ms);
}

/** The value at quantile `q` of `values`, 0.5 the median. */
export function quantile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? Number.NaN;
}

/**
 * A word on the machine's load when it is high enough to slow the measuring, or null.
 * The window's checks run headless beside whatever else the machine does, and a busy machine slows the throttled runs most.
 */
export function loadNote(): string | null {
  const [load] = os.loadavg();
  const cores = os.cpus().length;
  return load > cores / 2 ? `The machine's load is ${load.toFixed(1)} on ${cores} cores, so these timings may be slower than the window is.` : null;
}

export interface Line {
  event: string;
  values: readonly number[];
  /** The budget the 95th percentile is held to, or null for one only reported. */
  budget: number | null;
}

/** Print what was measured, one line per event, so a pass says by how much too. */
export function report(title: string, lines: readonly Line[]): void {
  const ms = (value: number): string => `${value.toFixed(1)} ms`;
  const rows = lines.map(({ event, values, budget }) => `  ${event.padEnd(34)} median ${ms(quantile(values, 0.5)).padStart(10)}   p95 ${ms(quantile(values, 0.95)).padStart(10)}   ${budget === null ? 'reported only' : `budget ${ms(budget)}`}`);
  const note = loadNote();
  console.log([title, ...rows, ...(note ? [`  ${note}`] : [])].join('\n'));
}
