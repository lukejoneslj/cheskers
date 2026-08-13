/** Game SFX: a mix of recorded clips and procedural chiptune tones.
 *
 * The five effects with a matching recorded asset (move, jump, capture,
 * crown, and generic UI clicks) play from `public/sfx`. Everything without
 * one -- select/deselect, illegal, win, lose, tick -- stays synthesised from
 * oscillators and a noise buffer, so this file still ships most of its kit as
 * a couple of kilobytes of code rather than audio.
 */

type Wave = OscillatorType;

const CLIPS = {
  click: 'sfx/click.mp3',
  move: 'sfx/move.mp3',
  jump: 'sfx/multijump.mp3',
  capture: 'sfx/capture.mp3',
  crown: 'sfx/kingme.mp3',
} as const;

type ClipKey = keyof typeof CLIPS;

const CLIP_VOLUME = 0.55;

/** How far playback rate (recorded clips) and frequency (tones) wander from
 *  centre, as a fraction. The same clip playing dozens of times a game reads
 *  as a machine-gun loop without this -- a few percent of pitch drift is
 *  enough to sell "a person hit this" rather than "a sample retriggered". */
const PITCH_JITTER = 0.06;

const jitter = (amount = PITCH_JITTER): number => 1 + (Math.random() * 2 - 1) * amount;

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = true;
  private readonly clips = new Map<ClipKey, HTMLAudioElement>();

  get muted(): boolean {
    return !this.enabled;
  }

  setMuted(muted: boolean): void {
    this.enabled = !muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

  /** Browsers only allow audio after a gesture, so this is called from the
   *  first real interaction rather than at load. */
  unlock(): void {
    if (this.clips.size === 0) {
      for (const [key, src] of Object.entries(CLIPS) as [ClipKey, string][]) {
        const el = new Audio(`${import.meta.env.BASE_URL}${src}`);
        el.preload = 'auto';
        el.volume = CLIP_VOLUME;
        this.clips.set(key, el);
      }
    }

    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as {
      webkitAudioContext?: typeof AudioContext;
    }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.5 : 0;
    this.master.connect(this.ctx.destination);
  }

  /** Fires and forgets a clone of the clip so overlapping hits (a fast chain
   *  of jumps, say) don't cut each other off. */
  private clip(key: ClipKey): void {
    if (!this.enabled) return;
    const master = this.clips.get(key);
    if (!master) return;
    const instance = master.cloneNode(true) as HTMLAudioElement;
    instance.volume = CLIP_VOLUME;
    // Without this, Chrome/Firefox time-stretch to correct for the rate
    // change and the pitch never actually moves.
    (instance as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = false;
    (instance as HTMLAudioElement & { mozPreservesPitch?: boolean }).mozPreservesPitch = false;
    (instance as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = false;
    instance.playbackRate = jitter();
    void instance.play().catch(() => {});
  }

  private tone(
    freq: number,
    duration: number,
    { wave = 'square', gain = 0.12, at = 0, slideTo }: {
      wave?: Wave;
      gain?: number;
      at?: number;
      slideTo?: number;
    } = {},
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this.enabled) return;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq * jitter(), t);
    if (slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo * jitter()), t + duration);
    }
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(env).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  select(): void {
    this.tone(660, 0.06, { gain: 0.07 });
  }

  deselect(): void {
    this.tone(330, 0.05, { gain: 0.05 });
  }

  illegal(): void {
    this.tone(150, 0.12, { wave: 'sawtooth', gain: 0.07, slideTo: 90 });
  }

  move(): void {
    this.clip('move');
  }

  jump(): void {
    this.clip('jump');
  }

  capture(): void {
    this.clip('capture');
  }

  crown(): void {
    this.clip('crown');
  }

  win(): void {
    [523, 659, 784, 1047, 1319].forEach((f, i) =>
      this.tone(f, 0.3, { wave: 'square', gain: 0.1, at: i * 0.09 }),
    );
  }

  lose(): void {
    [440, 370, 294, 220].forEach((f, i) =>
      this.tone(f, 0.34, { wave: 'sawtooth', gain: 0.08, at: i * 0.11 }),
    );
  }

  tick(): void {
    this.clip('click');
  }
}

export const sound = new Sound();
