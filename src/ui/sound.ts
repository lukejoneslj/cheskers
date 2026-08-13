/** Procedural chiptune SFX.
 *
 * Everything is synthesised from oscillators and a noise buffer, so the game
 * ships no audio files and the whole kit costs a couple of kilobytes. Volumes
 * are deliberately low: this sits under the action rather than announcing it.
 */

type Wave = OscillatorType;

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private enabled = true;

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

    const frames = Math.floor(this.ctx.sampleRate * 0.4);
    this.noise = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
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
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + duration);
    }
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(env).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  private hiss(duration: number, gain = 0.1, at = 0, cutoff = 2200): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this.noise || !this.enabled) return;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, t);
    filter.frequency.exponentialRampToValueAtTime(300, t + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(env).connect(master);
    src.start(t);
    src.stop(t + duration + 0.02);
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
    this.tone(180, 0.09, { wave: 'triangle', gain: 0.13 });
    this.hiss(0.06, 0.05, 0, 900);
  }

  jump(): void {
    this.tone(300, 0.14, { wave: 'triangle', gain: 0.11, slideTo: 520 });
  }

  capture(): void {
    this.hiss(0.2, 0.16, 0, 3200);
    this.tone(220, 0.16, { wave: 'square', gain: 0.1, slideTo: 70 });
  }

  crown(): void {
    [523, 659, 784, 1047].forEach((f, i) =>
      this.tone(f, 0.16, { wave: 'square', gain: 0.09, at: i * 0.06 }),
    );
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
    this.tone(880, 0.03, { gain: 0.04 });
  }
}

export const sound = new Sound();
