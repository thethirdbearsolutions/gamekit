// Real key presses for a page, by action name. Holds are diffed so a key is
// only pressed or released when the wanted set changes, like a player's hands.
import type { Page } from 'playwright-core';

export type ActionKeys = Record<string, readonly string[]>;

export class KeyHands {
  private readonly held = new Set<string>();
  presses = 0;

  constructor(private readonly page: Page, private readonly actions: ActionKeys) {}

  keyFor(action: string): string {
    const k = this.actions[action]?.[0];
    if (!k) throw new Error(`No key bound to action "${action}"`);
    return k;
  }

  /** Hold exactly these actions; release anything else. */
  async hold(actions: Iterable<string>): Promise<void> {
    const want = new Set([...actions].map((a) => this.keyFor(a)));
    for (const k of [...this.held]) if (!want.has(k)) { await this.page.keyboard.up(k); this.held.delete(k); }
    for (const k of want) if (!this.held.has(k)) { await this.page.keyboard.down(k); this.held.add(k); this.presses++; }
  }

  /** Press and release, `ms` apart (real time). */
  async tap(action: string, ms = 40): Promise<void> {
    const k = this.keyFor(action);
    const wasHeld = this.held.has(k);
    if (wasHeld) { await this.page.keyboard.up(k); this.held.delete(k); }
    await this.page.keyboard.down(k);
    this.presses++;
    if (ms > 0) await this.page.waitForTimeout(ms);
    await this.page.keyboard.up(k);
  }

  async releaseAll(): Promise<void> {
    await this.hold([]);
  }
}
