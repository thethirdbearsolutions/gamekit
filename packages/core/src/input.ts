// Action input map. Keys (KeyboardEvent.code) bind to exactly one action each.
// Raw key events are buffered and read once per fixed step with `sample()`,
// so a tap shorter than a step is latched and still seen as one press.
// Scripted input feeds the same buffer, so tests exercise the real path.

export type Bindings<A extends string> = Record<A, readonly string[]>;

export interface InputFrame<A extends string> {
  tick: number;
  /** Down at any point during this step. */
  held(action: A): boolean;
  /** Went down since the previous sample (latched; never lost). */
  pressed(action: A): boolean;
  /** Went up since the previous sample. */
  released(action: A): boolean;
  /** Bitmask of held actions in binding order, for hashing and replays. */
  readonly bits: number;
}

export interface ScriptEvent<A extends string> {
  tick: number;
  action: A;
  /** down/up hold an action; tap presses and releases within the one step. */
  type: 'down' | 'up' | 'tap';
}

export class InputMap<A extends string> {
  readonly actions: readonly A[];
  private readonly keyToAction = new Map<string, A>();
  private readonly keysDown = new Set<string>();
  private readonly pendingPress = new Set<A>();
  private readonly pendingRelease = new Set<A>();
  private recording: ScriptEvent<A>[] | null = null;
  private lastTick = -1;

  constructor(readonly bindings: Bindings<A>) {
    this.actions = Object.keys(bindings) as A[];
    if (this.actions.length > 31) throw new Error('InputMap: at most 31 actions');
    for (const a of this.actions) {
      for (const key of bindings[a]) {
        const prev = this.keyToAction.get(key);
        if (prev && prev !== a) throw new Error(`InputMap: key ${key} bound to both ${prev} and ${a}`);
        this.keyToAction.set(key, a);
      }
    }
  }

  actionFor(key: string): A | undefined {
    return this.keyToAction.get(key);
  }

  isHeld(action: A): boolean {
    for (const k of this.bindings[action]) if (this.keysDown.has(k)) return true;
    return false;
  }

  /** Feed a raw key down. Returns true if the key is bound (caller may preventDefault). */
  keyDown(key: string): boolean {
    const a = this.keyToAction.get(key);
    if (!a) return false;
    if (!this.keysDown.has(key)) {
      const before = this.isHeld(a);
      this.keysDown.add(key);
      if (!before) {
        this.pendingPress.add(a);
        this.recording?.push({ tick: this.lastTick + 1, action: a, type: 'down' });
      }
    }
    return true;
  }

  keyUp(key: string): boolean {
    const a = this.keyToAction.get(key);
    if (!a || !this.keysDown.delete(key)) return !!a;
    if (!this.isHeld(a)) {
      this.pendingRelease.add(a);
      this.recording?.push({ tick: this.lastTick + 1, action: a, type: 'up' });
    }
    return true;
  }

  /** Release everything (window blur, pause). */
  releaseAll(): void {
    for (const k of [...this.keysDown]) this.keyUp(k);
  }

  /** Drive an action directly (scripts, bots, touch buttons). */
  actionDown(action: A): void {
    this.keyDown(this.bindings[action][0] ?? `__${action}`);
  }

  actionUp(action: A): void {
    this.keyUp(this.bindings[action][0] ?? `__${action}`);
  }

  /** Read input for one fixed step. Call exactly once per step. */
  sample(tick: number): InputFrame<A> {
    const held = new Set<A>();
    for (const a of this.actions) if (this.isHeld(a) || this.pendingPress.has(a)) held.add(a);
    const pressed = new Set(this.pendingPress);
    const released = new Set(this.pendingRelease);
    this.pendingPress.clear();
    this.pendingRelease.clear();
    this.lastTick = tick;
    let bits = 0;
    this.actions.forEach((a, i) => { if (held.has(a)) bits |= 1 << i; });
    return {
      tick, bits,
      held: (a) => held.has(a),
      pressed: (a) => pressed.has(a),
      released: (a) => released.has(a),
    };
  }

  /** Listen to keyboard events on a DOM target. Returns a detach function. */
  attach(target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>, opts: { preventDefault?: boolean } = {}): () => void {
    const prevent = opts.preventDefault ?? true;
    const down = (e: Event) => {
      const k = e as KeyboardEvent;
      if (this.keyDown(k.code) && prevent) k.preventDefault();
    };
    const up = (e: Event) => {
      const k = e as KeyboardEvent;
      if (this.keyUp(k.code) && prevent) k.preventDefault();
    };
    const blur = () => this.releaseAll();
    target.addEventListener('keydown', down);
    target.addEventListener('keyup', up);
    target.addEventListener('blur', blur);
    return () => {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
      target.removeEventListener('blur', blur);
    };
  }

  /** Start recording raw input as a replayable script (ticks are the step
   *  each event is first sampled in). */
  startRecording(): void {
    this.recording = [];
  }

  stopRecording(): ScriptEvent<A>[] {
    const r = this.recording ?? [];
    this.recording = null;
    return r;
  }
}

/** Replays a script into an InputMap; call `apply(tick)` before `sample(tick)`. */
export class ScriptedInput<A extends string> {
  private i = 0;
  private readonly events: ScriptEvent<A>[];

  constructor(private readonly map: InputMap<A>, script: readonly ScriptEvent<A>[]) {
    this.events = [...script].sort((a, b) => a.tick - b.tick);
  }

  apply(tick: number): void {
    while (this.i < this.events.length && this.events[this.i].tick <= tick) {
      const e = this.events[this.i++];
      if (e.type === 'down') this.map.actionDown(e.action);
      else if (e.type === 'up') this.map.actionUp(e.action);
      else { this.map.actionDown(e.action); this.map.actionUp(e.action); }
    }
  }

  get done(): boolean {
    return this.i >= this.events.length;
  }
}
