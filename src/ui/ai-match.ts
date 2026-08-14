/** Single-player against the AI. Mirrors `Lobby`'s shape deliberately: the AI
 *  is wired up exactly like a network opponent (same `MatchBinding`, same
 *  `applyRemoteMove` for its moves), it just computes those moves in a Web
 *  Worker instead of receiving them from Firebase.
 *
 *  This is also the shared driver for Mania and the campaign — both hand it a
 *  `MatchSpec` (ruleset, opponent name, difficulty) and get told the result. */

import { DIFFICULTIES } from '../engine/ai';
import type { AiRequest, AiResponse } from '../engine/ai.protocol';
import type { Color, Rules } from '../engine/types';
import { DEFAULT_RULES } from '../engine/types';
import type { App } from './app';
import type { MatchPeer } from './match-peer';
import { sound } from './sound';

export type DifficultyKey = keyof typeof DIFFICULTIES;
export type MatchResult = 'win' | 'loss' | 'draw';

export interface MatchSpec {
  humanColor: Color;
  difficulty: DifficultyKey;
  rules?: Rules;
  /** Shown on the opponent's player card. Defaults to `AI · <DIFFICULTY>`. */
  opponentName?: string;
  playerName?: string;
  /** Called once the game finishes, from the local player's point of view. */
  onEnd?: (result: MatchResult) => void;
  /** Called after any move lands, for commentary and reaction lines. */
  onMove?: (mover: Color, captured: boolean) => void;
  /** When false, the game-over "PLAY AGAIN" button hands control back to the
   *  owning mode instead of silently restarting the same position. */
  onRematch?: () => void;
}

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
};

// A very fast search can return in a handful of milliseconds on an empty-ish
// board, which reads as suspicious rather than smart. Floor how quickly a
// move can land so the opponent never feels instant.
const MIN_THINK_MS = 350;

export class AiMatch implements MatchPeer {
  private peer: MatchPeer | null = null;
  private worker: Worker | null = null;
  private active = false;
  private spec: MatchSpec | null = null;
  private aiColor: Color = 'b';
  private requestSeq = 0;
  private thinkStartedAt = 0;
  private historySeen = 0;

  private readonly dom = {
    modal: el('ai-modal'),
    color: el<HTMLSelectElement>('ai-color'),
    difficulty: el<HTMLSelectElement>('ai-difficulty'),
    start: el<HTMLButtonElement>('ai-start'),
    close: el<HTMLButtonElement>('ai-close'),
    leave: el<HTMLButtonElement>('ai-leave'),
  };

  constructor(private readonly app: App) {
    this.bind();
  }

  /** Online play takes the same board binding this does; each has to yield
   *  it before starting its own match. */
  setPeer(peer: MatchPeer): void {
    this.peer = peer;
  }

  get inMatch(): boolean {
    return this.active;
  }

  private bind(): void {
    el('btn-ai').addEventListener('click', () => {
      this.dom.modal.hidden = false;
      this.dom.leave.hidden = !this.active;
    });
    this.dom.close.addEventListener('click', () => {
      this.dom.modal.hidden = true;
    });
    this.dom.start.addEventListener('click', () => {
      sound.tick();
      const colorChoice = this.dom.color.value as Color | 'random';
      this.dom.modal.hidden = true;
      this.startMatch({
        humanColor:
          colorChoice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : colorChoice,
        difficulty: this.dom.difficulty.value as DifficultyKey,
      });
      this.dom.leave.hidden = false;
    });
    this.dom.leave.addEventListener('click', () => {
      sound.tick();
      this.leave();
    });

    window.addEventListener('cheskers:rematch', () => {
      if (!this.active) return;
      this.requestSeq++; // any search still in flight belonged to the old game
      const spec = this.spec;
      // app.ts sets a "waiting for opponent" hint right after dispatching
      // this event, which would otherwise stomp the hint newGame() clears --
      // there's no opponent to wait for here, so defer past that.
      window.setTimeout(() => {
        if (spec?.onRematch) {
          spec.onRematch();
          return;
        }
        if (!this.active || !spec) return;
        this.begin(spec);
      }, 0);
    });

    window.addEventListener('cheskers:gameover', () => {
      if (!this.active) return;
      // A resignation ends the game synchronously, but a search already in
      // flight would otherwise still land a move into a finished game.
      this.requestSeq++;
      const spec = this.spec;
      if (!spec?.onEnd) return;
      const state = this.app.getState();
      const result: MatchResult =
        state.winner === null ? 'draw' : state.winner === spec.humanColor ? 'win' : 'loss';
      // Let the game-over modal paint before any mode-owned overlay lands.
      window.setTimeout(() => spec.onEnd?.(result), 0);
    });
  }

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../engine/ai.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (e: MessageEvent<AiResponse>) => this.onWorkerMessage(e.data);
    }
    return this.worker;
  }

  /** Start (or restart) a match. The single entry point for the plain
   *  "PLAY VS AI" button, Mania and the campaign alike. */
  startMatch(spec: MatchSpec): void {
    this.peer?.leave();
    this.spec = spec;
    this.active = true;
    this.begin(spec);
  }

  private begin(spec: MatchSpec): void {
    this.aiColor = spec.humanColor === 'w' ? 'b' : 'w';
    this.requestSeq++; // invalidate anything left over from a previous game
    this.historySeen = 0;

    this.app.resetForMatch(spec.rules ?? DEFAULT_RULES);
    const names: Partial<Record<Color, string>> = {};
    names[spec.humanColor] = spec.playerName ?? 'YOU';
    names[this.aiColor] =
      spec.opponentName ?? `AI · ${DIFFICULTIES[spec.difficulty].label.toUpperCase()}`;

    this.app.setBinding({
      control: spec.humanColor,
      names,
      onLocalMove: () => this.afterAnyMove(),
    });

    this.dom.leave.hidden = false;
    this.maybeMoveAI();
  }

  leave(): void {
    if (!this.active) return;
    this.active = false;
    this.spec = null;
    this.requestSeq++;
    this.dom.leave.hidden = true;
    this.dom.modal.hidden = true;
    this.app.setBinding({ control: 'both' });
    this.app.resetForMatch(DEFAULT_RULES);
  }

  private afterAnyMove(): void {
    const state = this.app.getState();
    const spec = this.spec;
    if (spec?.onMove) {
      // Report only moves we have not already reported; a jump chain fires
      // this callback once per link.
      for (let i = this.historySeen; i < state.history.length; i++) {
        const record = state.history[i]!;
        spec.onMove(record.color, record.capturedKind !== null);
      }
    }
    this.historySeen = state.history.length;
    this.maybeMoveAI();
  }

  /** Kick off a search if it's currently the AI's turn -- called after every
   *  move, human or AI, since the engine's jump-chain mechanic can leave the
   *  same side to move again. */
  private maybeMoveAI(): void {
    if (!this.active || !this.spec) return;
    const state = this.app.getState();
    if (state.status !== 'playing' || state.turn !== this.aiColor) return;

    const requestId = ++this.requestSeq;
    this.thinkStartedAt = performance.now();
    const request: AiRequest = { requestId, state, difficulty: this.spec.difficulty };
    this.getWorker().postMessage(request);
  }

  private onWorkerMessage(response: AiResponse): void {
    if (!this.active || response.requestId !== this.requestSeq || !response.move) return;

    const elapsed = performance.now() - this.thinkStartedAt;
    const delay = Math.max(0, MIN_THINK_MS - elapsed);
    const move = response.move;
    window.setTimeout(() => {
      if (response.requestId !== this.requestSeq) return; // superseded while waiting
      this.app.applyRemoteMove(move);
      this.afterAnyMove();
    }, delay);
  }
}
