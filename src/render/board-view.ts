/** The canvas board: draws it, animates it, and turns clicks into squares.
 *
 * The renderer keeps its own visual model — one `Visual` per piece id, holding
 * a position in art units — rather than drawing straight from `GameState`.
 * That indirection is what lets a piece be *in transit*: the game state has
 * already moved it, while on screen it is still sliding, squashing on landing,
 * or bursting into particles. Piece ids from the engine are what tie the two
 * models together.
 */

import type { Color, GameState, Move, Piece, Sq } from '../engine/types';
import { col, row, sq as toSq } from '../engine/types';
import { Particles } from './particles';
import { BOARD_UNITS, SQUARE_UNITS, SpriteAtlas, type SpriteKey, spriteKey } from './sprites';
import { overlay, palette } from './theme';
import {
  Timeline,
  easeInCubic,
  easeOutBack,
  easeOutCubic,
  sequence,
  timed,
} from './tween';

/** How far above the bottom edge of its square a piece stands. */
const BASE_PAD = 3;
const GLIDE_SECONDS = 0.24;
const JUMP_SECONDS = 0.34;

interface Visual {
  id: number;
  key: SpriteKey;
  color: Color;
  sq: Sq;
  /** Square-centre position in art units. */
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  alpha: number;
  /** Raised off the board, in units — used for hover and for jump arcs. */
  lift: number;
  /** 0..1 white-out, flashed on the frame a piece is captured. */
  flash: number;
  z: number;
}

export interface BoardCallbacks {
  onSquare(square: Sq): void;
  onAnimationEnd?(): void;
}

export class BoardView {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly timeline = new Timeline();
  private readonly particles = new Particles();
  private readonly visuals = new Map<number, Visual>();

  /** Device pixels per art unit. Always an integer, which is what keeps the
   *  sprites crisp rather than resampled. */
  private scale = 3;
  private flipped = false;
  private hover: Sq | null = null;
  private selected: Sq | null = null;
  private targets: Move[] = [];
  private lastMove: Move | null = null;
  private chain: Sq | null = null;
  private interactive = true;

  private shake = 0;
  private clock = 0;
  private raf = 0;
  private lastFrame = 0;
  private zCounter = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly atlas: SpriteAtlas,
    private readonly callbacks: BoardCallbacks,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    this.bindInput();
  }

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------

  /** Fit the board into `cssSize` CSS pixels, snapping to a whole number of
   *  device pixels per art unit so nothing is ever half-pixel blurred. */
  resize(cssSize: number): void {
    const dpr = window.devicePixelRatio || 1;
    const wanted = Math.floor((cssSize * dpr) / BOARD_UNITS);
    this.scale = Math.max(1, wanted);
    const backing = BOARD_UNITS * this.scale;
    this.canvas.width = backing;
    this.canvas.height = backing;
    this.canvas.style.width = `${backing / dpr}px`;
    this.canvas.style.height = `${backing / dpr}px`;
    this.ctx.imageSmoothingEnabled = false;
    this.draw();
  }

  get cssSize(): number {
    return this.canvas.clientWidth;
  }

  setFlipped(flipped: boolean): void {
    if (this.flipped === flipped) return;
    this.flipped = flipped;
    for (const v of this.visuals.values()) {
      const p = this.centre(v.sq);
      v.x = p.x;
      v.y = p.y;
    }
  }

  private viewRow(r: number): number {
    return this.flipped ? 7 - r : r;
  }

  private viewCol(c: number): number {
    return this.flipped ? 7 - c : c;
  }

  private centre(square: Sq): { x: number; y: number } {
    return {
      x: this.viewCol(col(square)) * SQUARE_UNITS + SQUARE_UNITS / 2,
      y: this.viewRow(row(square)) * SQUARE_UNITS + SQUARE_UNITS / 2,
    };
  }

  private squareAt(clientX: number, clientY: number): Sq | null {
    const rect = this.canvas.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * BOARD_UNITS;
    const py = ((clientY - rect.top) / rect.height) * BOARD_UNITS;
    if (px < 0 || py < 0 || px >= BOARD_UNITS || py >= BOARD_UNITS) return null;
    const vc = Math.floor(px / SQUARE_UNITS);
    const vr = Math.floor(py / SQUARE_UNITS);
    return toSq(this.viewRow(vr), this.viewCol(vc));
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  private bindInput(): void {
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.interactive) return;
      const square = this.squareAt(e.clientX, e.clientY);
      if (square !== null) this.callbacks.onSquare(square);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const square = this.interactive ? this.squareAt(e.clientX, e.clientY) : null;
      if (square !== this.hover) this.hover = square;
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.hover = null;
    });
  }

  setInteractive(on: boolean): void {
    this.interactive = on;
    if (!on) this.hover = null;
  }

  setSelection(selected: Sq | null, targets: Move[]): void {
    this.selected = selected;
    this.targets = targets;
  }

  setChain(chain: Sq | null): void {
    this.chain = chain;
  }

  get busy(): boolean {
    return this.timeline.busy;
  }

  // -------------------------------------------------------------------------
  // Syncing engine state to the visual model
  // -------------------------------------------------------------------------

  /** Rebuild the visual model from scratch, with no animation. Used for a new
   *  game and whenever a remote snapshot arrives that we cannot animate into. */
  reset(state: GameState): void {
    this.timeline.finishAll();
    this.particles.clear();
    this.visuals.clear();
    this.lastMove = null;
    this.selected = null;
    this.targets = [];
    this.chain = state.chain;
    state.board.forEach((piece, square) => {
      if (piece) this.visuals.set(piece.id, this.makeVisual(piece, square));
    });
    this.draw();
  }

  private makeVisual(piece: Piece, square: Sq): Visual {
    const { x, y } = this.centre(square);
    return {
      id: piece.id,
      key: spriteKey(piece),
      color: piece.color,
      sq: square,
      x,
      y,
      scaleX: 1,
      scaleY: 1,
      alpha: 1,
      lift: 0,
      flash: 0,
      z: 0,
    };
  }

  /** Animate one applied move, then reconcile against the resulting state. */
  animate(before: GameState, move: Move, after: GameState): void {
    const mover = before.board[move.from];
    if (!mover) {
      this.reset(after);
      return;
    }
    const visual = this.visuals.get(mover.id);
    if (!visual) {
      this.reset(after);
      return;
    }

    this.lastMove = move;
    this.selected = null;
    this.targets = [];
    this.chain = after.chain;

    const from = this.centre(move.from);
    const to = this.centre(move.to);
    const duration = move.isJump ? JUMP_SECONDS : GLIDE_SECONDS;
    const arc = move.isJump ? SQUARE_UNITS * 0.55 : 0;

    visual.sq = move.to;
    visual.z = ++this.zCounter; // travel above everything it passes over

    const victim = move.captured !== null ? before.board[move.captured] : null;
    const victimVisual = victim ? this.visuals.get(victim.id) ?? null : null;
    let victimDone = false;

    this.timeline.add(
      timed({
        duration,
        ease: move.isJump ? easeOutCubic : easeOutBack,
        onUpdate: (t) => {
          visual.x = from.x + (to.x - from.x) * t;
          visual.y = from.y + (to.y - from.y) * t;
          // Parabola peaking at the midpoint of a hop.
          visual.lift = arc * Math.sin(Math.PI * t);
          // The victim shatters just before the attacker arrives.
          if (!victimDone && t > 0.62 && victimVisual) {
            victimDone = true;
            this.killVisual(victimVisual);
          }
        },
        onDone: () => {
          visual.x = to.x;
          visual.y = to.y;
          visual.lift = 0;
          visual.z = 0;
          if (victimVisual && !victimDone) this.killVisual(victimVisual);
          this.land(visual, move.isJump);
          if (move.promotes) this.crown(visual, after);
          this.reconcile(after);
        },
      }),
    );

    if (after.status === 'over' && after.winReason === 'king-capture') {
      this.shake = 1;
    }
  }

  /** Squash-and-stretch on arrival. Small, but it is most of what makes the
   *  move feel like it has weight. */
  private land(visual: Visual, hard: boolean): void {
    const squash = hard ? 0.72 : 0.84;
    this.timeline.add(
      sequence(
        timed({
          duration: 0.06,
          onUpdate: (t) => {
            visual.scaleY = 1 - (1 - squash) * t;
            visual.scaleX = 1 + (1 - squash) * 0.8 * t;
          },
        }),
        timed({
          duration: 0.26,
          ease: easeOutBack,
          onUpdate: (t) => {
            visual.scaleY = squash + (1 - squash) * t;
            visual.scaleX = 1 + (1 - squash) * 0.8 * (1 - t);
          },
          onDone: () => {
            visual.scaleX = 1;
            visual.scaleY = 1;
          },
        }),
      ),
    );
  }

  private killVisual(visual: Visual): void {
    const px = visual.x;
    const py = visual.y;
    const colours =
      visual.color === 'w'
        ? [palette.white, palette.cream, palette.edge]
        : [palette.steel, palette.white, palette.edge];
    this.particles.burstCapture(px, py, colours);
    this.timeline.add(
      sequence(
        timed({
          duration: 0.07,
          onUpdate: (t) => {
            visual.flash = t;
            visual.scaleX = 1 + 0.25 * t;
            visual.scaleY = 1 + 0.25 * t;
          },
        }),
        timed({
          duration: 0.16,
          ease: easeInCubic,
          onUpdate: (t) => {
            visual.alpha = 1 - t;
            visual.scaleX = 1.25 - 1.25 * t;
            visual.scaleY = 1.25 - 1.25 * t;
          },
          onDone: () => this.visuals.delete(visual.id),
        }),
      ),
    );
  }

  private crown(visual: Visual, after: GameState): void {
    const piece = after.board[visual.sq];
    if (piece) visual.key = spriteKey(piece);
    this.particles.burstCrown(visual.x, visual.y - 6);
    this.timeline.add(
      timed({
        duration: 0.42,
        ease: easeOutBack,
        onUpdate: (t) => {
          const pop = 1 + 0.4 * Math.sin(Math.PI * t);
          visual.scaleX = pop;
          visual.scaleY = pop;
          visual.lift = 5 * Math.sin(Math.PI * t);
        },
        onDone: () => {
          visual.scaleX = 1;
          visual.scaleY = 1;
          visual.lift = 0;
        },
      }),
    );
  }

  /** Jump every in-flight animation to its end state.
   *
   * Called when the player acts during an animation, and when the tab becomes
   * visible again. The latter matters because `requestAnimationFrame` stops
   * while a tab is hidden: without this, a move begun just before the player
   * switched away would leave tweens that never tick.
   */
  settle(state: GameState): void {
    // Completing a move tween queues its follow-up landing and crown tweens,
    // so a single pass is not enough to drain the timeline.
    this.timeline.finishAll();
    this.timeline.finishAll();
    this.particles.clear();
    this.syncVisuals(state);
    for (const visual of this.visuals.values()) {
      visual.scaleX = 1;
      visual.scaleY = 1;
      visual.alpha = 1;
      visual.lift = 0;
      visual.flash = 0;
      visual.z = 0;
    }
    this.shake = 0;
  }

  /** Make sure the visual model matches the authoritative board once the
   *  animation has played out — a cheap guard against drift. */
  private reconcile(state: GameState): void {
    this.syncVisuals(state);
    this.callbacks.onAnimationEnd?.();
  }

  private syncVisuals(state: GameState): void {
    const live = new Set<number>();
    state.board.forEach((piece, square) => {
      if (!piece) return;
      live.add(piece.id);
      const existing = this.visuals.get(piece.id);
      if (!existing) {
        this.visuals.set(piece.id, this.makeVisual(piece, square));
        return;
      }
      existing.sq = square;
      existing.key = spriteKey(piece);
      const p = this.centre(square);
      existing.x = p.x;
      existing.y = p.y;
    });
    for (const [id, visual] of this.visuals) {
      // Leave dying visuals alone; their own tween removes them.
      if (!live.has(id) && visual.alpha === 1) this.visuals.delete(id);
    }
  }

  celebrate(square: Sq): void {
    const { x, y } = this.centre(square);
    this.particles.burstVictory(x, y);
    this.shake = 1;
  }

  // -------------------------------------------------------------------------
  // Frame loop
  // -------------------------------------------------------------------------

  start(): void {
    if (this.raf) return;
    this.lastFrame = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      this.clock += dt;
      this.timeline.update(dt);
      this.particles.update(dt);
      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 2.2);
      this.draw();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  private draw(): void {
    const { ctx, scale } = this;
    const size = BOARD_UNITS * scale;
    ctx.save();
    ctx.clearRect(0, 0, size, size);

    if (this.shake > 0) {
      const amp = this.shake * this.shake * 4 * scale;
      ctx.translate(
        Math.round((Math.random() - 0.5) * amp),
        Math.round((Math.random() - 0.5) * amp),
      );
    }

    this.drawSquares();
    this.drawHighlights();
    this.drawMarkers();
    this.drawPieces();
    this.particles.draw(ctx, scale);
    ctx.restore();
  }

  private drawSquares(): void {
    const { ctx, scale } = this;
    const s = SQUARE_UNITS * scale;
    for (let vr = 0; vr < 8; vr++) {
      for (let vc = 0; vc < 8; vc++) {
        const light = (vr + vc) % 2 === 0;
        ctx.fillStyle = light ? palette.squareLight : palette.squareDark;
        ctx.fillRect(vc * s, vr * s, s, s);
        this.drawGrain(vc, vr, light);
      }
    }
  }

  /** A handful of deterministic darker pixels per square. Flat colour reads as
   *  plastic at this scale; a little grain reads as a board. */
  private drawGrain(vc: number, vr: number, light: boolean): void {
    const { ctx, scale } = this;
    ctx.fillStyle = light ? 'rgba(150,110,60,0.13)' : 'rgba(50,28,12,0.16)';
    let seed = (vr * 8 + vc) * 2654435761;
    for (let i = 0; i < 9; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const ux = (seed >> 7) % SQUARE_UNITS;
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const uy = (seed >> 7) % SQUARE_UNITS;
      ctx.fillRect(
        (vc * SQUARE_UNITS + ux) * scale,
        (vr * SQUARE_UNITS + uy) * scale,
        scale * 2,
        scale,
      );
    }
  }

  private fillSquare(square: Sq, style: string): void {
    const { ctx, scale } = this;
    const s = SQUARE_UNITS * scale;
    const vc = this.viewCol(col(square));
    const vr = this.viewRow(row(square));
    ctx.fillStyle = style;
    ctx.fillRect(vc * s, vr * s, s, s);
  }

  private drawHighlights(): void {
    if (this.lastMove) {
      this.fillSquare(this.lastMove.from, overlay.lastMove);
      this.fillSquare(this.lastMove.to, overlay.lastMove);
    }
    if (this.selected !== null) {
      // Breathe so the selection never looks like a static stain.
      const pulse = 0.42 + 0.16 * Math.sin(this.clock * 6);
      this.fillSquare(this.selected, `rgba(255, 201, 60, ${pulse.toFixed(3)})`);
    }
    if (this.chain !== null) {
      const pulse = 0.35 + 0.2 * Math.sin(this.clock * 9);
      this.fillSquare(this.chain, `rgba(79, 155, 255, ${pulse.toFixed(3)})`);
    }
    if (this.hover !== null && this.hover !== this.selected) {
      this.fillSquare(this.hover, overlay.hover);
    }
  }

  private drawMarkers(): void {
    const { ctx, scale } = this;
    const bob = Math.sin(this.clock * 5) * 0.6;
    for (const move of this.targets) {
      const { x, y } = this.centre(move.to);
      if (move.captured !== null) {
        // A ring, drawn as four pixel brackets so it stays on-grid.
        ctx.fillStyle = overlay.captureRing;
        const half = SQUARE_UNITS / 2 - 2;
        const len = 6;
        const corners: [number, number][] = [
          [-half, -half], [half - len, -half],
          [-half, half - 1], [half - len, half - 1],
        ];
        for (const [ox, oy] of corners) {
          ctx.fillRect((x + ox) * scale, (y + oy) * scale, len * scale, scale);
        }
        const verticals: [number, number][] = [
          [-half, -half], [half - 1, -half],
          [-half, half - len], [half - 1, half - len],
        ];
        for (const [ox, oy] of verticals) {
          ctx.fillRect((x + ox) * scale, (y + oy) * scale, scale, len * scale);
        }
      } else {
        const r = 3;
        ctx.fillStyle = overlay.moveDot;
        ctx.fillRect(
          Math.round((x - r) * scale),
          Math.round((y - r + bob) * scale),
          r * 2 * scale,
          r * 2 * scale,
        );
        ctx.fillStyle = overlay.moveDotEdge;
        ctx.fillRect(
          Math.round((x - r) * scale),
          Math.round((y + r + bob) * scale),
          r * 2 * scale,
          scale,
        );
      }
    }
  }

  private drawPieces(): void {
    // Painter's order: further up the board first, then anything mid-flight,
    // so a travelling piece always passes in front of what it flies over.
    const ordered = [...this.visuals.values()].sort(
      (a, b) => a.z - b.z || a.y - b.y,
    );
    for (const visual of ordered) this.drawPiece(visual);
  }

  private drawPiece(visual: Visual): void {
    const { ctx, scale } = this;
    const sprite = this.atlas.get(visual.key);
    if (!sprite) return;

    const hovered =
      this.interactive && this.hover === visual.sq && this.selected !== visual.sq;
    const selected = this.selected === visual.sq;
    const idleLift = selected ? 2 + Math.sin(this.clock * 5) * 1.2 : hovered ? 1.5 : 0;
    const lift = visual.lift + idleLift;

    // Anchor at the bottom-centre of the sprite so squash reads as weight.
    const anchorX = visual.x;
    const anchorY = visual.y + SQUARE_UNITS / 2 - BASE_PAD - lift;

    this.drawShadow(anchorX, visual.y + SQUARE_UNITS / 2 - BASE_PAD, lift, visual.alpha);

    ctx.save();
    ctx.globalAlpha = visual.alpha;
    ctx.translate(Math.round(anchorX * scale), Math.round(anchorY * scale));
    if (visual.scaleX !== 1 || visual.scaleY !== 1) {
      ctx.scale(visual.scaleX, visual.scaleY);
    }
    const w = sprite.w * scale;
    const h = sprite.h * scale;
    ctx.drawImage(sprite.image, Math.round(-w / 2), -h, w, h);

    if (visual.flash > 0) {
      // Re-stamp the sprite as a solid white silhouette on the capture frame.
      ctx.globalCompositeOperation = 'source-atop';
      ctx.globalAlpha = visual.alpha * visual.flash;
      ctx.fillStyle = palette.cream;
      ctx.fillRect(Math.round(-w / 2), -h, w, h);
    }
    ctx.restore();
  }

  /** Grounding shadow, rasterised on the art grid rather than drawn as a
   *  smooth ellipse so it matches the sprites. */
  private drawShadow(cx: number, groundY: number, lift: number, alpha: number): void {
    const { ctx, scale } = this;
    const spread = 1 - Math.min(0.5, lift / (SQUARE_UNITS * 0.8));
    const rx = 7 * spread;
    const ry = 2.2 * spread;
    ctx.fillStyle = `rgba(20, 12, 6, ${(0.3 * spread * alpha).toFixed(3)})`;
    for (let dy = -Math.round(ry); dy <= Math.round(ry); dy++) {
      const halfWidth = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy / ry) ** 2)));
      if (halfWidth <= 0) continue;
      ctx.fillRect(
        Math.round((cx - halfWidth) * scale),
        Math.round((groundY + dy) * scale),
        halfWidth * 2 * scale,
        scale,
      );
    }
  }
}
