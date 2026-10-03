// Metrics and event logs, written as JSON next to the videos.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface Sample { t: number; [metric: string]: unknown }

/** Collects timestamped samples and named events during a run. */
export class RunLog {
  readonly samples: Sample[] = [];
  readonly events: { t: number; type: string; [k: string]: unknown }[] = [];
  readonly counters: Record<string, number> = {};
  private lastKey = new Map<string, unknown>();

  sample(t: number, metrics: Record<string, unknown>): void {
    this.samples.push({ t: round(t), ...metrics });
  }

  event(t: number, type: string, data: Record<string, unknown> = {}): void {
    this.events.push({ t: round(t), type, ...data });
    this.count(type);
  }

  count(name: string, by = 1): void {
    this.counters[name] = (this.counters[name] ?? 0) + by;
  }

  /** Log an event only when `value` differs from the last one seen for `key`
   *  (mode changes, phase changes). */
  change(t: number, key: string, value: unknown, data: Record<string, unknown> = {}): void {
    if (this.lastKey.has(key) && this.lastKey.get(key) === value) return;
    this.lastKey.set(key, value);
    this.event(t, `${key}`, { value, ...data });
  }

  toJSON() {
    return { counters: this.counters, events: this.events, samples: this.samples };
  }
}

const round = (t: number) => Math.round(t * 100) / 100;

export async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + '\n');
}
