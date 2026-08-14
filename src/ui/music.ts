/** Background music with smooth crossfades between tracks.
 *
 * Two <audio> elements swap the role of "active"/"idle" on every crossfade,
 * so the outgoing track keeps playing while it fades out instead of cutting.
 * The gameplay pair (1 and 2) ping-pong: the currently playing track arms a
 * handoff a few seconds before it ends, so the next one is already fading in
 * by the time the first one finishes rather than leaving a gap of silence.
 */

type TrackKey = 'title' | 'selecting' | 'gameplay1' | 'gameplay2';

const SOURCES: Record<TrackKey, string> = {
  title: 'music/title-screen.mp3',
  selecting: 'music/selecting-game-mode.mp3',
  gameplay1: 'music/gameplay-1.mp3',
  gameplay2: 'music/gameplay-2.mp3',
};

const LOOPING: Partial<Record<TrackKey, true>> = { title: true, selecting: true };

const VOLUME = 0.32;
const FADE_MS = 1500;
const HANDOFF_LEAD_S = 1.6;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export class Music {
  private a = new Audio();
  private b = new Audio();
  private active = this.a;
  private idle = this.b;
  private current: TrackKey | null = null;
  private enabled = true;
  private generation = 0;
  private fadeRaf = 0;
  private blocked: HTMLAudioElement | null = null;
  private detune = 1;

  constructor() {
    for (const el of [this.a, this.b]) {
      el.preload = 'auto';
      el.volume = 0;
    }
  }

  /** Play everything at `rate` times its natural speed, pitch included -- the
   *  campaign drops this slightly below 1 as the horror level climbs, so the
   *  soundtrack sags without ever changing track. */
  setDetune(rate: number): void {
    this.detune = Math.max(0.5, Math.min(1.5, rate));
    for (const el of [this.a, this.b]) this.applyRate(el);
  }

  private applyRate(el: HTMLAudioElement): void {
    // Without this the browser time-stretches to hold pitch constant, and the
    // detune is inaudible.
    const any = el as HTMLAudioElement & {
      preservesPitch?: boolean;
      mozPreservesPitch?: boolean;
      webkitPreservesPitch?: boolean;
    };
    any.preservesPitch = false;
    any.mozPreservesPitch = false;
    any.webkitPreservesPitch = false;
    el.playbackRate = this.detune;
  }

  get muted(): boolean {
    return !this.enabled;
  }

  setMuted(muted: boolean): void {
    this.enabled = !muted;
    if (muted) {
      this.a.pause();
      this.b.pause();
      return;
    }
    if (this.current) {
      const key = this.current;
      this.current = null;
      this.crossfadeTo(key);
    }
  }

  /** Retry a track that autoplay policy blocked, from inside a user gesture.
   *
   *  This has to retry `.play()` on the exact blocked element rather than
   *  going through `crossfadeTo()` -- that bails out immediately whenever the
   *  requested key already matches `current`, which it always does here
   *  since `crossfadeTo()` sets `current` before the play() attempt that just
   *  failed. Routing the retry through it would silently no-op. */
  unlock(): void {
    if (!this.blocked) return;
    const el = this.blocked;
    this.blocked = null;
    el.play().catch(() => {
      this.blocked = el;
    });
  }

  playTitle(): void {
    this.crossfadeTo('title');
  }

  enterMenu(): void {
    this.crossfadeTo('selecting');
  }

  enterGame(): void {
    this.crossfadeTo(Math.random() < 0.5 ? 'gameplay1' : 'gameplay2');
  }

  private crossfadeTo(key: TrackKey): void {
    if (this.current === key) return;
    this.current = key;
    this.generation += 1;
    const gen = this.generation;
    if (!this.enabled) return;

    const incoming = this.idle;
    const outgoing = this.active;
    this.active = incoming;
    this.idle = outgoing;

    incoming.src = SOURCES[key];
    incoming.loop = LOOPING[key] === true;
    incoming.currentTime = 0;
    incoming.volume = 0;
    incoming.onended = null;
    this.applyRate(incoming);

    if (!incoming.loop) this.armGameplayHandoff(incoming, key, gen);

    incoming.play().catch(() => {
      // Blocked until a gesture arrives; unlock() retries once one lands.
      this.blocked = incoming;
    });

    this.fade(outgoing, incoming, gen);
  }

  private armGameplayHandoff(el: HTMLAudioElement, key: TrackKey, gen: number): void {
    const next = key === 'gameplay1' ? 'gameplay2' : 'gameplay1';
    const onTime = () => {
      if (gen !== this.generation || !isFinite(el.duration)) return;
      if (el.currentTime >= el.duration - HANDOFF_LEAD_S) {
        el.removeEventListener('timeupdate', onTime);
        this.crossfadeTo(next);
      }
    };
    // A track can also just end outright (duration mismatch, seek, etc.) --
    // fall back to a plain crossfade so the music never just stops.
    const onEnded = () => {
      if (gen !== this.generation) return;
      this.crossfadeTo(next);
    };
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('ended', onEnded, { once: true });
  }

  private fade(outgoing: HTMLAudioElement, incoming: HTMLAudioElement, gen: number): void {
    cancelAnimationFrame(this.fadeRaf);
    const start = performance.now();
    const from = outgoing.volume;
    const step = (now: number) => {
      if (gen !== this.generation) return;
      const t = Math.min(1, Math.max(0, (now - start) / FADE_MS));
      incoming.volume = clamp01(VOLUME * t);
      outgoing.volume = clamp01(from * (1 - t));
      if (t < 1) {
        this.fadeRaf = requestAnimationFrame(step);
      } else if (outgoing !== incoming) {
        outgoing.pause();
        outgoing.currentTime = 0;
      }
    };
    this.fadeRaf = requestAnimationFrame(step);
  }
}

export const music = new Music();
