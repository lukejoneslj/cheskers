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

import { type Augment, draft } from '../engine/augments';
import { augCard, renderHeld } from './aug-ui';
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

/** A card's face value for the `gambler` hand: 1 through 10, standing in for
 *  a standard deck without needing suit art or Ace soft/hard logic -- the
 *  game is "closest to 21," not real blackjack, so the simplification does
 *  not cost it anything. */
function drawCard(): number {
  return 1 + Math.floor(Math.random() * 10);
}

const handTotal = (cards: number[]): number => cards.reduce((n, c) => n + c, 0);

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
  /** The live `gambler` hand, while one is in progress. */
  private gamble: { you: number[]; dealer: number[]; over: boolean } | null = null;

  private readonly dom = {
    modal: el('mania-modal'),
    intro: el('mania-intro'),
    draftPane: el('mania-draft'),
    cards: el('mania-cards'),
    round: el('mania-round'),
    note: el('mania-note'),
    gamble: el('mania-gamble'),
    gambleYouCards: el('gamble-you-cards'),
    gambleYouTotal: el('gamble-you-total'),
    gambleYouHand: el('gamble-you-cards').closest('.gamble-hand') as HTMLElement,
    gambleDealerCards: el('gamble-dealer-cards'),
    gambleDealerTotal: el('gamble-dealer-total'),
    gambleDealerHand: el('gamble-dealer-cards').closest('.gamble-hand') as HTMLElement,
    gambleResult: el('gamble-result'),
    gambleHit: el<HTMLButtonElement>('gamble-hit'),
    gambleStand: el<HTMLButtonElement>('gamble-stand'),
    gambleContinue: el<HTMLButtonElement>('gamble-continue'),
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
    this.dom.gambleHit.addEventListener('click', () => {
      sound.tick();
      this.gambleHit();
    });
    this.dom.gambleStand.addEventListener('click', () => {
      sound.tick();
      this.gambleStand();
    });
    this.dom.gambleContinue.addEventListener('click', () => {
      sound.tick();
      this.finishGamble();
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
    this.gamble = null;
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
    // was the previous round's reveal or a gambler hand.
    this.dom.cards.hidden = false;
    this.dom.gamble.hidden = true;
    this.gamble = null;
    this.dom.reply.hidden = true;
    this.dom.go.hidden = true;

    this.renderLoadouts();

    const cards = this.dom.cards;
    cards.replaceChildren();
    for (const a of this.offered) {
      const card = augCard(a);
      card.addEventListener('click', () => this.pick(a));
      cards.appendChild(card);
    }
  }

  private renderLoadouts(): void {
    renderHeld(this.dom.held, this.mine, 'YOURS');
    renderHeld(this.dom.heldTheirs, this.theirs, 'THEIRS');
  }

  private pick(choice: Augment): void {
    sound.tick();
    this.mine.push(choice.id);

    // `questline` does not do anything itself -- it is a marker that starts
    // a two-round clock, settled at the top of `nextRound`.
    if (choice.id === 'questline') this.questlineTarget = this.round + 2;

    // `gambler` opens an actual hand rather than resolving on the spot --
    // the opponent's reply and the BEGIN ROUND button wait for it to finish,
    // see `finishGamble`.
    if (choice.id === 'gambler') {
      this.startGamble();
      return;
    }

    this.dealReply(null);
  }

  /** The opponent's answering draft, plus the reveal screen. Split out from
   *  `pick` so `finishGamble` can call it once the hand is over. */
  private dealReply(note: string | null): void {
    // The opponent answers with one of its own, drawn from what is left. Its
    // pool excludes what it already holds but *not* what the player took --
    // both sides can end up running the same augment, which is fine.
    const reply = draft(this.theirs, 1, this.round)[0];
    if (reply) this.theirs.push(reply.id);
    this.showReply(reply ?? null, note);
  }

  // -- gambler: an actual hand of "closest to 21" ---------------------------

  private startGamble(): void {
    this.gamble = { you: [drawCard(), drawCard()], dealer: [drawCard()], over: false };
    this.dom.cards.hidden = true;
    this.dom.gamble.hidden = false;
    this.dom.gambleResult.hidden = true;
    this.dom.gambleContinue.hidden = true;
    this.dom.gambleHit.hidden = false;
    this.dom.gambleStand.hidden = false;
    this.renderGamble();
  }

  private gambleHit(): void {
    if (!this.gamble || this.gamble.over) return;
    this.gamble.you.push(drawCard());
    if (handTotal(this.gamble.you) >= 21) this.gambleStand();
    else this.renderGamble();
  }

  private gambleStand(): void {
    if (!this.gamble || this.gamble.over) return;
    // The dealer plays second and in the open: hit on 16 or below, stop at
    // 17+. Skips entirely if the player already busted -- no need to draw a
    // hand nobody is going to compare it to.
    if (handTotal(this.gamble.you) <= 21) {
      while (handTotal(this.gamble.dealer) < 17) this.gamble.dealer.push(drawCard());
    }
    this.gamble.over = true;
    this.renderGamble();
    this.settleGamble();
  }

  private renderGamble(): void {
    const g = this.gamble;
    if (!g) return;
    const you = handTotal(g.you);
    const dealerRevealed = g.over;
    const dealer = handTotal(g.dealer);

    const renderHand = (host: HTMLElement, cards: number[], hideLast: boolean) => {
      host.replaceChildren();
      cards.forEach((c, i) => {
        const card = document.createElement('span');
        card.className = 'gamble-card';
        const hidden = hideLast && i === cards.length - 1 && cards.length > 1;
        card.dataset.hidden = String(hidden);
        card.textContent = hidden ? '?' : String(c);
        host.appendChild(card);
      });
    };

    renderHand(this.dom.gambleYouCards, g.you, false);
    this.dom.gambleYouTotal.textContent = String(you);
    this.dom.gambleYouHand.dataset.bust = String(you > 21);
    this.dom.gambleYouHand.dataset.blackjack = String(you === 21);

    // The dealer's second card stays face down until you stand or bust --
    // that is the entire tension of the genre.
    renderHand(this.dom.gambleDealerCards, g.dealer, !dealerRevealed);
    this.dom.gambleDealerTotal.textContent = dealerRevealed ? String(dealer) : '?';
    this.dom.gambleDealerHand.dataset.bust = String(dealerRevealed && dealer > 21);
    this.dom.gambleDealerHand.dataset.blackjack = String(dealerRevealed && dealer === 21);

    const busted = you > 21;
    this.dom.gambleHit.disabled = busted;
    if (busted && !g.over) {
      g.over = true;
      this.settleGamble();
    }
  }

  /** Decide the hand and update the loadout. A win keeps `gambler` and drafts
   *  a bonus on top of it, weighted well toward the rare end of the pool
   *  since it is a reward, not an ordinary pick. A loss or a push takes
   *  `gambler` back -- the bet is spent either way. */
  private settleGamble(): void {
    const g = this.gamble;
    if (!g) return;
    const you = handTotal(g.you);
    const dealer = handTotal(g.dealer);
    const held = this.mine.filter((id) => id !== 'gambler');
    const youBust = you > 21;
    const dealerBust = dealer > 21;
    const win = !youBust && (dealerBust || you > dealer);
    const push = !youBust && !dealerBust && you === dealer;

    let result: string;
    if (win) {
      const bonus = draft(held, 1, this.round + 6)[0];
      this.mine = bonus ? [...held, 'gambler', bonus.id] : [...held, 'gambler'];
      result = bonus
        ? `YOU WIN ${you} TO ${dealerBust ? 'a bust' : dealer} — ${bonus.glyph} ${bonus.name}!`
        : `YOU WIN ${you} TO ${dealerBust ? 'A BUST' : dealer} — BUT YOU HOLD EVERYTHING ALREADY.`;
    } else if (push) {
      this.mine = held;
      result = `YOU PUSH AT ${you} APIECE. THE BET IS RETURNED.`;
    } else {
      this.mine = held;
      result = youBust
        ? `YOU BUST AT ${you}. THE BET IS GONE.`
        : `THE DEALER WINS ${dealer} TO ${you}. THE BET IS GONE.`;
    }

    this.dom.gambleResult.hidden = false;
    this.dom.gambleResult.textContent = result;
    this.dom.gambleHit.hidden = true;
    this.dom.gambleStand.hidden = true;
    this.dom.gambleContinue.hidden = false;
    sound.tick();
  }

  private finishGamble(): void {
    this.gamble = null;
    this.dom.gamble.hidden = true;
    this.dealReply(null);
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
      const card = augCard(reply);
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
    this.gamble = null;
    this.dom.quit.hidden = true;
    this.dom.modal.hidden = true;
    this.ai.leave();
    this.app.setModePanel(null);
    this.app.setModeLabel('LOCAL GAME');
    music.enterMenu();
    screens.show('menu');
  }
}
