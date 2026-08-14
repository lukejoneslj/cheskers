/** THE LONG GAME — the campaign shell.
 *
 * Owns the chapter select, the dialogue overlay, and the horror level. The
 * actual games are played by `AiMatch`; this module only decides who the
 * opponent is, what they are allowed to do, and what they say.
 */

import { CHAPTERS, type Chapter } from '../campaign/chapters';
import { loadProgress, markCleared, resetProgress } from '../campaign/progress';
import { augment } from '../engine/augments';
import { DEFAULT_RULES, type Color, type Rules } from '../engine/types';
import type { AiMatch, MatchResult } from './ai-match';
import type { App } from './app';
import { resetHorror, setHorror } from './horror';
import { music } from './music';
import { screens } from './screens';
import { sound } from './sound';

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
};

/** How often a capture draws a line out of the opponent. Every capture would
 *  be noise; never would be a silent opponent. */
const TAUNT_CHANCE = 0.28;

export class Campaign {
  private active: Chapter | null = null;
  private queue: string[] = [];
  private onQueueDone: (() => void) | null = null;
  private lastTauntAt = 0;

  private readonly dom = {
    modal: el('campaign-modal'),
    list: el('campaign-list'),
    close: el<HTMLButtonElement>('campaign-close'),
    reset: el<HTMLButtonElement>('campaign-reset'),
    quit: el<HTMLButtonElement>('campaign-quit'),

    scene: el('scene'),
    sceneGlyph: el('scene-glyph'),
    sceneName: el('scene-name'),
    sceneTitle: el('scene-title'),
    sceneLine: el('scene-line'),
    sceneNext: el<HTMLButtonElement>('scene-next'),
    sceneAugments: el('scene-augments'),
  };

  constructor(
    private readonly ai: AiMatch,
    private readonly app: App,
  ) {
    this.bind();
    this.renderList();
  }

  private bind(): void {
    el('mode-campaign').addEventListener('click', () => {
      sound.tick();
      this.renderList();
      this.dom.modal.hidden = false;
      this.dom.quit.hidden = this.active === null;
    });

    // The menu's back button tears every mode down; the campaign has horror
    // state and a chapter in progress to clear.
    window.addEventListener('cheskers:leave-modes', () => {
      this.active = null;
      this.dom.quit.hidden = true;
      this.dom.scene.hidden = true;
      this.queue = [];
      this.onQueueDone = null;
    });
    this.dom.close.addEventListener('click', () => {
      sound.tick();
      this.dom.modal.hidden = true;
    });
    this.dom.reset.addEventListener('click', () => {
      sound.tick();
      resetProgress();
      this.renderList();
    });
    this.dom.quit.addEventListener('click', () => {
      sound.tick();
      this.quit();
    });

    this.dom.sceneNext.addEventListener('click', () => {
      sound.tick();
      this.advance();
    });
    // The whole scrim advances too -- clicking the tiny button every line
    // turns dialogue into clerical work.
    this.dom.scene.addEventListener('click', (e) => {
      if (e.target === this.dom.scene) this.advance();
    });
  }

  // -------------------------------------------------------------------------
  // Chapter select
  // -------------------------------------------------------------------------

  private renderList(): void {
    const { cleared } = loadProgress();
    const list = this.dom.list;
    list.replaceChildren();

    CHAPTERS.forEach((chapter, i) => {
      const done = cleared.includes(chapter.id);
      // A chapter opens once the one before it is cleared. The first is
      // always open; nothing else is spoilered by name until it is reachable.
      const previous = CHAPTERS[i - 1];
      const unlocked = i === 0 || (previous ? cleared.includes(previous.id) : false);

      const item = document.createElement('li');
      item.className = 'chapter';
      item.dataset.state = done ? 'done' : unlocked ? 'open' : 'locked';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chapter-btn';
      button.disabled = !unlocked;

      const glyph = unlocked ? chapter.glyph : '🔒';
      const name = unlocked ? chapter.name : '— — —';
      const title = unlocked ? chapter.title : 'Not yet';

      button.innerHTML =
        `<span class="chapter-numeral">${chapter.numeral}</span>` +
        `<span class="chapter-glyph"></span>` +
        `<span class="chapter-body">` +
        `<span class="chapter-name"></span>` +
        `<span class="chapter-title"></span>` +
        `</span>` +
        `<span class="chapter-mark">${done ? '✓' : ''}</span>`;
      // Names are static content, but keep the same textContent discipline as
      // the rest of the app so this never becomes an injection point.
      button.querySelector('.chapter-glyph')!.textContent = glyph;
      button.querySelector('.chapter-name')!.textContent = name;
      button.querySelector('.chapter-title')!.textContent = title;

      button.addEventListener('click', () => {
        sound.tick();
        this.begin(chapter);
      });

      item.appendChild(button);
      list.appendChild(item);
    });
  }

  // -------------------------------------------------------------------------
  // Running a chapter
  // -------------------------------------------------------------------------

  private begin(chapter: Chapter): void {
    this.active = chapter;
    this.dom.modal.hidden = true;
    this.dom.quit.hidden = false;
    setHorror(chapter.horror);
    // Show the board behind the dialogue rather than the menu, so the scene
    // reads as sitting down at a table.
    screens.show('game');
    this.app.setModeLabel(`${chapter.numeral} · ${chapter.name}`);
    this.app.setModePanel({
      title: 'THE LONG GAME',
      action: 'CHAPTERS',
      onClick: () => {
        this.renderList();
        this.dom.modal.hidden = false;
        this.dom.quit.hidden = false;
      },
    });
    this.say(chapter, chapter.intro, () => this.startMatch(chapter));
  }

  private rulesFor(chapter: Chapter): Rules {
    const opponent: Color = chapter.playerColor === 'w' ? 'b' : 'w';
    return {
      ...DEFAULT_RULES,
      augments: { [opponent]: [...chapter.augments] },
    };
  }

  private startMatch(chapter: Chapter): void {
    music.enterGame();
    this.ai.startMatch({
      humanColor: chapter.playerColor,
      difficulty: chapter.difficulty,
      rules: this.rulesFor(chapter),
      opponentName: chapter.name,
      onMove: (mover, captured) => this.onMove(chapter, mover, captured),
      onEnd: (result) => this.finish(chapter, result),
      onRematch: () => this.startMatch(chapter),
    });
  }

  private onMove(chapter: Chapter, mover: Color, captured: boolean): void {
    if (!captured || mover === chapter.playerColor) return;
    const now = performance.now();
    // Never two lines back to back, however unlucky the rolls are.
    if (now - this.lastTauntAt < 9000) return;
    if (Math.random() > TAUNT_CHANCE) return;
    this.lastTauntAt = now;
    const line = chapter.taunts[Math.floor(Math.random() * chapter.taunts.length)];
    if (line) this.flash(chapter, line);
  }

  private finish(chapter: Chapter, result: MatchResult): void {
    const won = result === 'win';
    if (won) markCleared(chapter.id, chapter.horror);
    const lines = won ? chapter.onDefeat : chapter.onVictory;
    this.say(chapter, lines, () => {
      this.renderList();
      if (won && chapter.id === CHAPTERS[CHAPTERS.length - 1]!.id) {
        this.quit();
        return;
      }
      // Back to the chapter list either way: won means the next one is open,
      // lost means they can try again.
      this.dom.modal.hidden = false;
      this.dom.quit.hidden = false;
    });
  }

  private quit(): void {
    this.active = null;
    this.dom.quit.hidden = true;
    this.dom.modal.hidden = true;
    this.dom.scene.hidden = true;
    resetHorror();
    this.ai.leave();
    this.app.setModePanel(null);
    this.app.setModeLabel('LOCAL GAME');
    music.enterMenu();
    screens.show('menu');
  }

  // -------------------------------------------------------------------------
  // Dialogue
  // -------------------------------------------------------------------------

  /** Queue a run of lines, then call `done`. */
  private say(chapter: Chapter, lines: ReadonlyArray<string>, done: () => void): void {
    this.dom.sceneGlyph.textContent = chapter.glyph;
    this.dom.sceneName.textContent = chapter.name;
    this.dom.sceneTitle.textContent = chapter.title;
    this.dom.scene.dataset.horror = String(chapter.horror);

    // Show what the opponent is bringing, so a loss never feels arbitrary.
    const augs = this.dom.sceneAugments;
    augs.replaceChildren();
    for (const id of chapter.augments) {
      const a = augment(id);
      const chip = document.createElement('span');
      chip.className = 'scene-aug';
      chip.dataset.rarity = a.rarity;
      chip.title = a.blurb;
      chip.textContent = `${a.glyph} ${a.name}`;
      augs.appendChild(chip);
    }
    augs.hidden = chapter.augments.length === 0;

    this.queue = [...lines];
    this.onQueueDone = done;
    this.dom.scene.hidden = false;
    this.advance();
  }

  private advance(): void {
    const next = this.queue.shift();
    if (next === undefined) {
      this.dom.scene.hidden = true;
      const done = this.onQueueDone;
      this.onQueueDone = null;
      done?.();
      return;
    }
    this.dom.sceneLine.textContent = next;
    // Restart the type-on animation for each line.
    this.dom.sceneLine.classList.remove('typing');
    void this.dom.sceneLine.offsetWidth;
    this.dom.sceneLine.classList.add('typing');
    this.dom.sceneNext.textContent = this.queue.length === 0 ? 'BEGIN' : 'NEXT';
  }

  /** A single line shown over the board mid-game, without pausing anything. */
  private flash(chapter: Chapter, line: string): void {
    const node = el('taunt');
    node.querySelector('.taunt-who')!.textContent = chapter.name;
    node.querySelector('.taunt-line')!.textContent = line;
    node.hidden = false;
    node.classList.remove('show');
    void node.offsetWidth;
    node.classList.add('show');
    window.setTimeout(() => {
      node.classList.remove('show');
      window.setTimeout(() => (node.hidden = true), 400);
    }, 3600);
  }
}
