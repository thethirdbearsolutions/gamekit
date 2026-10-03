// The page side of a playtest. A game opts in by exposing window.__game.

export interface GameHandle<S = unknown> {
  /** Plain, JSON-serialisable observable state. */
  state(): S;
  /** Action name → keys (KeyboardEvent.code); first key is the one pressed. */
  actions: Record<string, readonly string[]>;
  /** Optional: game events since start (anything with a `type`). */
  events?(): { type: string; [k: string]: unknown }[];
  /** Optional: deterministic state digest (@gamekit/core hashState). */
  hash?(): string;
  /** Optional, required for frame-stepped capture: run exactly n sim steps
   *  and render once. The page should start paused when `?paused=1`. */
  step?(n?: number): void;
  pause?(): void;
  resume?(): void;
}

declare global {
  interface Window { __game?: GameHandle }
}

/** What a policy returns each tick. */
export interface Decision {
  /** Actions to keep held (everything else is released). */
  hold?: readonly string[];
  /** Actions to tap once, in order, after updating holds. */
  tap?: readonly string[];
  /** Real-time pause before the next decision, in ms (default pollMs). */
  waitMs?: number;
  /** End the run (goal reached or given up). */
  done?: boolean;
  /** Free text recorded in the event log. */
  note?: string;
}

export interface PolicyContext {
  /** Seconds since play started (wall clock). */
  t: number;
  /** Scratch space that persists across calls. */
  memory: Record<string, unknown>;
  /** Run parameters (e.g. the variant being played). */
  params: Record<string, string>;
}

export type Policy<S = any> = (state: S, ctx: PolicyContext) => Decision;
