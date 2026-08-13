/** Chunky pixel particles for capture bursts and crowning sparkles.
 *
 * Particles are drawn as squares snapped to the art grid, never as smooth
 * circles, so they stay in the same visual language as the sprites.
 */

import { palette } from './theme';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
}

const pick = <T,>(list: readonly T[]): T =>
  list[Math.floor(Math.random() * list.length)]!;

export class Particles {
  private items: Particle[] = [];

  get active(): boolean {
    return this.items.length > 0;
  }

  clear(): void {
    this.items = [];
  }

  private spawn(p: Particle): void {
    // Hard cap so a long jump chain can never snowball into a frame-rate cliff.
    if (this.items.length < 400) this.items.push(p);
  }

  /** A piece has just been taken: shrapnel in the victim's colours. */
  burstCapture(x: number, y: number, colors: readonly string[]): void {
    for (let i = 0; i < 18; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 22 + Math.random() * 48;
      this.spawn({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 24,
        life: 0,
        maxLife: 0.34 + Math.random() * 0.3,
        size: Math.random() < 0.4 ? 2 : 1,
        color: pick(colors),
        gravity: 150,
      });
    }
  }

  /** A checker has been crowned: gold sparks that drift upward. */
  burstCrown(x: number, y: number): void {
    for (let i = 0; i < 26; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
      const speed = 26 + Math.random() * 46;
      this.spawn({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 0.5 + Math.random() * 0.45,
        size: Math.random() < 0.5 ? 2 : 1,
        color: pick([palette.gold, palette.cream, '#ffe89a']),
        gravity: 58,
      });
    }
  }

  /** The King has fallen: a bigger, redder, slower blast. */
  burstVictory(x: number, y: number): void {
    for (let i = 0; i < 60; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 30 + Math.random() * 90;
      this.spawn({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 30,
        life: 0,
        maxLife: 0.7 + Math.random() * 0.6,
        size: Math.random() < 0.35 ? 3 : 2,
        color: pick([palette.red, palette.gold, palette.cream]),
        gravity: 110,
      });
    }
  }

  update(dt: number): void {
    if (this.items.length === 0) return;
    for (const p of this.items) {
      p.life += dt;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.items = this.items.filter((p) => p.life < p.maxLife);
  }

  /** `scale` converts art units to device pixels. */
  draw(ctx: CanvasRenderingContext2D, scale: number): void {
    for (const p of this.items) {
      const t = p.life / p.maxLife;
      // Flicker out in steps rather than a smooth fade, which suits pixel art.
      if (t > 0.55 && Math.floor(p.life * 30) % 2 === 0) continue;
      ctx.fillStyle = p.color;
      const s = Math.max(1, Math.round(p.size * (1 - t * 0.4))) * scale;
      ctx.fillRect(Math.round(p.x * scale), Math.round(p.y * scale), s, s);
    }
  }
}
