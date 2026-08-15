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
  /** The round `questline` pays out at, once the player has drafted it. */
  private questlineTarget: number | null = null;

  private readonly dom = {
    modal: el('mania-modal'),
    intro: el('mania-intro'),
    draftPane: el('mania-draft'),
    cards: el('mania-cards'),
    round: el('mania-round'),
    note: el('mania-note'),
    reply: el('mania-reply'),
    replyLabel: el('mania-reply-label'),
    replyCard: el('mania-reply-card'),
    go: el<HTMLButtonElement>('mania-go'),
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
    this.dom.go.addEventListener('click', () => {
      sound.tick();
      this.dom.modal.hidden = true;
      this.beginMatch();
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
    this.questlineTarget = null;
    this.playerColor = Math.random() < 0.5 ? 'w' : 'b';
    this.dom.quit.hidden = false;
    this.nextRound();
  }

  private nextRound(): void {
    this.round++;

    // `questline` pays out on its own schedule, ahead of the ordinary draft:
    // holding it for two full rounds cashes it in for something better, and
    // the quest itself is spent in the trade.
    const questNote = this.settleQuestline();

    this.offered = draft(this.mine, 3, this.round);
    if (this.offered.length === 0) {
      // Every augment in the game is held. Play on without a draft.
      this.beginMatch();
      return;
    }
    this.renderDraft(questNote);
  }

  /** Resolve `questline` if its two-round wait is up. Returns a note to show
   *  the player, or null if nothing happened this round. */
  private settleQuestline(): string | null {
    if (this.questlineTarget === null || this.round < this.questlineTarget) return null;
    this.questlineTarget = null;
    const held = this.mine.filter((id) => id !== 'questline');
    // Weighted well past where cursed cards dominate, so the payout reliably
    // reads as a reward rather than another common.
    const payout = draft(held, 1, this.round + 6)[0];
    this.mine = payout ? [...held, payout.id] : held;
    return payout
      ? `QUEST COMPLETE — your questline pays out ${payout.glyph} ${payout.name}.`
      : 'QUEST COMPLETE — but you already hold everything it could have paid.';
  }

  private renderDraft(note: string | null = null): void {
    this.dom.modal.hidden = false;
    this.dom.intro.hidden = true;
    this.dom.over.hidden = true;
    this.dom.draftPane.hidden = false;
    this.dom.round.textContent = `ROUND ${this.round} — YOUR PICK`;
    this.dom.note.hidden = !note;
    this.dom.note.textContent = note ?? '';

    // Back to the picking half of the draft, in case the last thing on screen
    // was the previous round's reveal.
    this.dom.cards.hidden = false;
    this.dom.reply.hidden = true;
    this.dom.go.hidden = true;

    this.renderLoadouts();

    const cards = this.dom.cards;
    cards.replaceChildren();
    for (const a of this.offered) {
      const card = this.augCard(a);
      card.addEventListener('click', () => this.pick(a));
      cards.appendChild(card);
    }
  }

  private augCard(a: Augment): HTMLButtonElement {
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
    return card;
  }

  private renderLoadouts(): void {
    this.renderHeld(this.dom.held, this.mine, 'YOURS');
    this.renderHeld(this.dom.heldTheirs, this.theirs, 'THEIRS');
  }

  /** Both loadouts are always on screen during a draft, empty or not: the
   *  opponent collects augments at exactly the rate you do, and hiding its
   *  row until it had one made it look like you were the only one rolling. */
  private renderHeld(host: HTMLElement, ids: ReadonlyArray<AugmentId>, label: string): void {
    host.replaceChildren();
    host.hidden = false;
    const tag = document.createElement('span');
    tag.className = 'held-label';
    tag.textContent = label;
    host.appendChild(tag);
    if (ids.length === 0) {
      const none = document.createElement('span');
      none.className = 'held-none';
      none.textContent = 'NOTHING YET';
      host.appendChild(none);
      return;
    }
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

    // `questline` does not do anything itself -- it is a marker that starts
    // a two-round clock, settled at the top of `nextRound`.
    if (choice.id === 'questline') this.questlineTarget = this.round + 2;

    // `gambler` resolves the instant it is drafted: one push-your-luck draw,
    // blessing or curse decided on the spot rather than sitting in the
    // loadout as a rule the engine has to know about.
    const gambleNote = choice.id === 'gambler' ? this.resolveGamble() : null;

    // The opponent answers with one of its own, drawn from what is left. Its
    // pool excludes what it already holds but *not* what the player took --
    // both sides can end up running the same augment, which is fine.
    const reply = draft(this.theirs, 1, this.round)[0];
    if (reply) this.theirs.push(reply.id);

    this.showReply(reply ?? null, gambleNote);
  }

  /** One draw of push-your-luck: two dealt totals, higher wins. A win drafts
   *  a bonus augment on top of `gambler` itself, weighted well toward the
   *  rare end of the pool since it is a reward, not an ordinary pick. A loss
   *  or a push takes `gambler` back -- the bet is spent either way. */
  private resolveGamble(): string {
    const draw = () => 1 + Math.floor(Math.random() * 10) + 1 + Math.floor(Math.random() * 10);
    const you = draw();
    const dealer = draw();
    const held = this.mine.filter((id) => id !== 'gambler');

    if (you > dealer) {
      const bonus = draft(held, 1, this.round + 6)[0];
      this.mine = bonus ? [...held, 'gambler', bonus.id] : [...held, 'gambler'];
      return bonus
        ? `GAMBLER — you drew ${you} against ${dealer} and win ${bonus.glyph} ${bonus.name}!`
        : `GAMBLER — you drew ${you} against ${dealer} and win, but hold everything already.`;
    }
    this.mine = held;
    return you === dealer
      ? `GAMBLER — you push at ${you} apiece. The bet is returned, table stays even.`
      : `GAMBLER — you drew ${you} against ${dealer} and bust. The bet is gone.`;
  }

  /** Hold the draft open long enough to show what the opponent took. */
  private showReply(reply: Augment | null, note: string | null = null): void {
    this.dom.round.textContent = `ROUND ${this.round} — THEIR PICK`;
    this.dom.note.hidden = !note;
    this.dom.note.textContent = note ?? '';
    this.dom.cards.hidden = true;
    this.dom.reply.hidden = false;
    this.dom.go.hidden = false;
    this.dom.replyLabel.textContent = reply
      ? 'YOUR OPPONENT ANSWERS WITH'
      : 'YOUR OPPONENT HAS NOTHING LEFT TO TAKE';
    this.dom.replyCard.replaceChildren();
    if (reply) {
      const card = this.augCard(reply);
      card.disabled = true;
      this.dom.replyCard.appendChild(card);
    }
    this.renderLoadouts();
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
    this.questlineTarget = null;
    this.dom.quit.hidden = true;
    this.dom.modal.hidden = true;
    this.ai.leave();
    this.app.setModePanel(null);
    this.app.setModeLabel('LOCAL GAME');
    music.enterMenu();
    screens.show('menu');
  }
}
