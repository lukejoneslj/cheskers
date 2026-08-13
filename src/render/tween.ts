/** A very small time-based animation kit.
 *
 * Everything on screen that moves is a `Tween`: something that gets ticked with
 * a delta time and reports when it is finished. Keeping the contract this thin
 * means the board renderer never has to special-case an animation type.
 */

export type Easing = (t: number) => number;

export const linear: Easing = (t) => t;
export const easeOutCubic: Easing = (t) => 1 - (1 - t) ** 3;
export const easeInCubic: Easing = (t) => t * t * t;
export const easeInOutCubic: Easing = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/** Overshoots past 1 and settles back — the "pop" that makes a landing feel
 *  physical rather than merely finished. */
export const easeOutBack: Easing = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

export const easeOutElastic: Easing = (t) => {
  if (t === 0 || t === 1) return t;
  const p = (2 * Math.PI) / 3;
  return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * p) + 1;
};

export interface Tween {
  /** Advance by `dt` seconds. Return true once the tween is complete. */
  update(dt: number): boolean;
  /** Run when the tween completes or is cancelled with `finish`. */
  cancel?(): void;
}

export interface TimedOptions {
  duration: number;
  ease?: Easing;
  delay?: number;
  onUpdate(v: number): void;
  onDone?(): void;
}

/** A tween that drives a 0..1 progress value through an easing curve. */
export function timed({
  duration,
  ease = linear,
  delay = 0,
  onUpdate,
  onDone,
}: TimedOptions): Tween {
  let elapsed = -delay;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    onUpdate(1);
    onDone?.();
  };
  return {
    update(dt) {
      if (done) return true;
      elapsed += dt;
      if (elapsed < 0) return false;
      if (elapsed >= duration) {
        finish();
        return true;
      }
      onUpdate(ease(elapsed / duration));
      return false;
    },
    cancel: finish,
  };
}

/** Runs tweens in order, one after the next. */
export function sequence(...steps: Tween[]): Tween {
  let i = 0;
  return {
    update(dt) {
      while (i < steps.length) {
        if (!steps[i]!.update(dt)) return false;
        i++;
        dt = 0; // the next step starts fresh on the following frame
      }
      return true;
    },
    cancel() {
      for (let j = i; j < steps.length; j++) steps[j]!.cancel?.();
    },
  };
}

/** Holds a set of running tweens and ticks them together. */
export class Timeline {
  private tweens: Tween[] = [];

  add(tween: Tween): void {
    this.tweens.push(tween);
  }

  get busy(): boolean {
    return this.tweens.length > 0;
  }

  update(dt: number): void {
    if (this.tweens.length === 0) return;
    this.tweens = this.tweens.filter((t) => !t.update(dt));
  }

  /** Immediately complete everything — used when a player clicks through an
   *  animation, or when remote state arrives mid-flight. */
  finishAll(): void {
    const running = this.tweens;
    this.tweens = [];
    for (const t of running) t.cancel?.();
  }
}
