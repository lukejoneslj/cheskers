/** CHESKERS MANIA — a run of games where both sides keep gaining rule changes.
 *
 * Before every round you draft one augment from three; the opponent then takes
 * one too, so the board gets stranger for both of you at the same rate. Lose a
 * round and the run is over — the point is how deep you got, not the single
 * game.
 *
 * All the actual behaviour lives in the engine (`rules.ts`), so the AI plays
 * an augmented board with no special handling at all.
 */

import { type Augment, augment, draft } from '../engine/augments';
import type { DifficultyKey } from './ai-match';
import type { AiMatch, MatchResult } from './ai-match';
import {
  DEFAULT_RULES,
  type AugmentId,
  type Color,
  type Rules,
} from '../engine/types';
import type { App } from './app';
import { music } from './music';
import { screens } from './screens';
import { sound } from './sound';

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
};

const BEST_KEY = 'cheskers:mania:best';

/** The opponent sharpens as the run goes on, independently of its augments. */
function difficultyForRound(round: number): DifficultyKey {
  if (round <= 2) return 'easy';
  if (round <= 5) return 'medium';
  return 'hard';
}

export class Mania {
  private running = false;
  private round = 0;
  private mine: AugmentId[] = [];
  private theirs: AugmentId[] = [];
  private offered: Augment[] = [];
  private playerColor: Color = 'w';

  private readonly dom = {
    modal: el('mania-modal'),
    intro: el('mania-intro'),
    draftPane: el('mania-draft'),
    cards: el('mania-cards'),
    round: el('mania-round'),
    held: el('mania-held'),
    heldTheirs: el('mania-held-theirs'),
    start: el<HTMLButtonElement>('mania-start'),
    again: el<HTMLButtonElement>('mania-start-again'),
    close: el<HTMLButtonElement>('mania-close'),
    quit: el<HTMLButtonElement>('mania-quit'),
    over: el('mania-over'),
    overTitle: el('mania-over-title'),
    overBody: el('mania-over-body'),
    best: el('mania-best'),
  };

  constructor(
    private readonly ai: AiMatch,
    private readonly app: App,
  ) {
    this.bind();
  }

  private bind(): void {
    el('mode-mania').addEventListener('click', () => {
      sound.tick();
      this.open();
    });

    window.addEventListener('cheskers:leave-modes', () => {
      this.running = false;
      this.dom.quit.hidden = true;
      this.dom.modal.hidden = true;
    });
    this.dom.close.addEventListener('click', () => {
      sound.tick();
      this.dom.modal.hidden = true;
    });
    this.dom.start.addEventListener('click', () => {
      sound.tick();
      this.startRun();
    });
    this.dom.again.addEventListener('click', () => {
      sound.tick();
      this.startRun();
    });
    this.dom.quit.addEventListener('click', () => {
      sound.tick();
      this.quit();
    });
  }

  private open(): void {
    this.dom.modal.hidden = false;
    this.dom.quit.hidden = !this.running;
    if (!this.running) this.showIntro();
  }

  private showIntro(): void {
    this.dom.intro.hidden = false;
    this.dom.draftPane.hidden = true;
    this.dom.over.hidden = true;
    this.dom.best.textContent = `BEST RUN: ${this.best()} ROUND${this.best() === 1 ? '' : 'S'}`;
  }

  private best(): number {
    try {
      return Number(localStorage.getItem(BEST_KEY) ?? '0') || 0;
    } catch {
      return 0;
    }
  }

  private recordBest(rounds: number): void {
    try {
      if (rounds > this.best()) localStorage.setItem(BEST_KEY, String(rounds));
    } catch {
      // Storage unavailable; the run still counts for this session.
    }
  }

  // -------------------------------------------------------------------------

  private startRun(): void {
    this.running = true;
    this.round = 0;
    this.mine = [];
    this.theirs = [];
    this.playerColor = Math.random() < 0.5 ? 'w' : 'b';
    this.dom.quit.hidden = false;
    this.nextRound();
  }

  private nextRound(): void {
    this.round++;
    this.offered = draft(this.mine, 3, this.round);
    if (this.offered.length === 0) {
      // Every augment in the game is held. Play on without a draft.
      this.beginMatch();
      return;
    }
    this.renderDraft();
  }

  private renderDraft(): void {
    this.dom.modal.hidden = false;
    this.dom.intro.hidden = true;
    this.dom.over.hidden = true;
    this.dom.draftPane.hidden = false;
    this.dom.round.textContent = `ROUND ${this.round}`;

    this.renderHeld(this.dom.held, this.mine, 'YOURS');
    this.renderHeld(this.dom.heldTheirs, this.theirs, 'THEIRS');

    const cards = this.dom.cards;
    cards.replaceChildren();
    for (const a of this.offered) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'aug-card';
      card.dataset.rarity = a.rarity;
      card.innerHTML =
        `<span class="aug-glyph"></span>` +
        `<span class="aug-name"></span>` +
        `<span class="aug-blurb"></span>` +
        `<span class="aug-rarity"></span>`;
      card.querySelector('.aug-glyph')!.textContent = a.glyph;
      card.querySelector('.aug-name')!.textContent = a.name;
      card.querySelector('.aug-blurb')!.textContent = a.blurb;
      card.querySelector('.aug-rarity')!.textContent = a.rarity.toUpperCase();
      card.addEventListener('click', () => this.pick(a));
      cards.appendChild(card);
    }
  }

  private renderHeld(host: HTMLElement, ids: ReadonlyArray<AugmentId>, label: string): void {
    host.replaceChildren();
    if (ids.length === 0) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    const tag = document.createElement('span');
    tag.className = 'held-label';
    tag.textContent = label;
    host.appendChild(tag);
    for (const id of ids) {
      const a = augment(id);
      const chip = document.createElement('span');
      chip.className = 'held-chip';
      chip.dataset.rarity = a.rarity;
      chip.title = a.blurb;
      chip.textContent = `${a.glyph} ${a.name}`;
      host.appendChild(chip);
    }
  }

  private pick(choice: Augment): void {
    sound.tick();
    this.mine.push(choice.id);

    // The opponent answers with one of its own, drawn from what is left. Its
    // pool excludes what it already holds but *not* what the player took --
    // both sides can end up running the same augment, which is fine.
    const reply = draft(this.theirs, 1, this.round)[0];
    if (reply) this.theirs.push(reply.id);

    this.dom.modal.hidden = true;
    this.beginMatch();
  }

  private rules(): Rules {
    const them: Color = this.playerColor === 'w' ? 'b' : 'w';
    return {
      ...DEFAULT_RULES,
      augments: {
        [this.playerColor]: [...this.mine],
        [them]: [...this.theirs],
      },
    };
  }

  private beginMatch(): void {
    music.enterGame();
    const difficulty = difficultyForRound(this.round);
    this.ai.startMatch({
      humanColor: this.playerColor,
      difficulty,
      rules: this.rules(),
      opponentName: `MANIA · R${this.round}`,
      onEnd: (result) => this.finish(result),
      onRematch: () => this.beginMatch(),
    });
    this.app.setModeLabel(`CHESKERS MANIA · ROUND ${this.round}`);
    this.app.setModePanel({
      title: 'MANIA',
      action: 'END RUN',
      onClick: () => this.quit(),
    });
    this.app.showHint(
      `ROUND ${this.round} — ${this.mine.length} AUGMENT${
        this.mine.length === 1 ? '' : 'S'
      } HELD`,
    );
  }

  private finish(result: MatchResult): void {
    if (!this.running) return;
    if (result === 'win') {
      window.setTimeout(() => this.nextRound(), 900);
      return;
    }
    // A draw ends the run too -- there is no "keep going" state that isn't a
    // win, and a survived draw would let a stalling player farm rounds.
    const survived = this.round - 1;
    this.recordBest(survived);
    this.running = false;
    this.dom.quit.hidden = true;
    this.dom.modal.hidden = false;
    this.dom.intro.hidden = true;
    this.dom.draftPane.hidden = true;
    this.dom.over.hidden = false;
    this.dom.again.hidden = false;
    this.dom.overTitle.textContent = 'RUN OVER';
    this.dom.overBody.textContent =
      survived > 0
        ? `You survived ${survived} round${survived === 1 ? '' : 's'} and collected ${
            this.mine.length
          } augment${this.mine.length === 1 ? '' : 's'}.`
        : 'Knocked out in the first round. The board only gets stranger from here.';
    this.dom.best.textContent = `BEST RUN: ${this.best()} ROUND${
      this.best() === 1 ? '' : 'S'
    }`;
  }

  private quit(): void {
    if (this.running) this.recordBest(this.round - 1);
    this.running = false;
    this.round = 0;
    this.mine = [];
    this.theirs = [];
    this.dom.quit.hidden = true;
    this.dom.modal.hidden = true;
    this.ai.leave();
    this.app.setModePanel(null);
    this.app.setModeLabel('LOCAL GAME');
    music.enterMenu();
    screens.show('menu');
  }
}
