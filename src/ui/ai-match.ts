/** Single-player vs. the AI. Mirrors `Lobby`'s shape deliberately: the AI is
 *  wired up exactly like a network opponent (same `MatchBinding`, same
 *  `applyRemoteMove` for its moves), it just computes those moves in a Web
 *  Worker instead of receiving them from Firebase. */

import { DIFFICULTIES } from '../engine/ai';
import type { AiRequest, AiResponse } from '../engine/ai.protocol';
import type { Color } from '../engine/types';
import type { App } from './app';
import type { MatchPeer } from './match-peer';
import { sound } from './sound';

type DifficultyKey = keyof typeof DIFFICULTIES;

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
  private aiColor: Color = 'b';
  private difficultyKey: DifficultyKey = 'medium';
  private requestSeq = 0;
  private thinkStartedAt = 0;

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
      this.start();
    });
    this.dom.leave.addEventListener('click', () => {
      sound.tick();
      this.leave();
    });

    window.addEventListener('cheskers:rematch', () => {
      if (!this.active) return;
      this.requestSeq++; // any search still in flight belonged to the old game
      // app.ts sets a "waiting for opponent" hint right after dispatching
      // this event, which would otherwise stomp the hint newGame() clears --
      // there's no opponent to wait for here, so defer past that.
      window.setTimeout(() => {
        this.app.resetForMatch(this.app.getState().rules);
        this.maybeMoveAI();
      }, 0);
    });

    // A resignation ends the game synchronously on click, but a search the AI
    // already had in flight would otherwise still land afterwards and play a
    // move into a game that's already over.
    window.addEventListener('cheskers:gameover', () => {
      this.requestSeq++;
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

  private start(): void {
    this.peer?.leave();

    const colorChoice = this.dom.color.value as Color | 'random';
    const humanColor: Color =
      colorChoice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : colorChoice;
    this.aiColor = humanColor === 'w' ? 'b' : 'w';
    this.difficultyKey = this.dom.difficulty.value as DifficultyKey;

    this.active = true;
    this.requestSeq++; // invalidate anything left over from a previous match
    this.app.newGame();
    this.app.setBinding({
      control: humanColor,
      names: {
        [humanColor]: 'YOU',
        [this.aiColor]: `AI · ${DIFFICULTIES[this.difficultyKey].label.toUpperCase()}`,
      } as Partial<Record<Color, string>>,
      onLocalMove: () => this.maybeMoveAI(),
    });

    this.dom.modal.hidden = true;
    this.dom.leave.hidden = false;
    this.maybeMoveAI();
  }

  leave(): void {
    if (!this.active) return;
    this.active = false;
    this.requestSeq++;
    this.dom.leave.hidden = true;
    this.dom.modal.hidden = true;
    this.app.setBinding({ control: 'both' });
    this.app.newGame();
  }

  /** Kick off a search if it's currently the AI's turn -- called after every
   *  move, human or AI, since the engine's jump-chain mechanic can leave the
   *  same side to move again. */
  private maybeMoveAI(): void {
    if (!this.active) return;
    const state = this.app.getState();
    if (state.status !== 'playing' || state.turn !== this.aiColor) return;

    const requestId = ++this.requestSeq;
    this.thinkStartedAt = performance.now();
    const request: AiRequest = { requestId, state, difficulty: this.difficultyKey };
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
      this.maybeMoveAI();
    }, delay);
  }
}
