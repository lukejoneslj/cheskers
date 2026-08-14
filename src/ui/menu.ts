/** The mode menu: the one place that knows how to start or abandon a game.
 *
 * Every mode owns its own modal and its own match logic; this module only
 * routes between them and makes sure that leaving a game tears down whichever
 * mode was running, rather than leaving an AI search or a room subscription
 * alive behind the menu.
 */

import { DEFAULT_RULES } from '../engine/types';
import type { AiMatch } from './ai-match';
import type { App } from './app';
import type { Lobby } from './lobby';
import { resetHorror } from './horror';
import { music } from './music';
import { screens } from './screens';
import { sound } from './sound';

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
};

export class Menu {
  constructor(
    private readonly app: App,
    private readonly ai: AiMatch,
    private readonly lobby: Lobby,
  ) {
    this.bind();
  }

  private bind(): void {
    el('mode-local').addEventListener('click', () => {
      sound.tick();
      // Pass-and-play is the only mode with no wrapper around it, so the menu
      // starts it directly.
      this.ai.leave();
      this.lobby.leave();
      this.app.setBinding({ control: 'both' });
      this.app.resetForMatch({ ...this.app.getState().rules, augments: {} });
      this.app.setModeLabel('PASS AND PLAY');
      this.app.setModePanel(null);
      screens.show('game');
      music.enterGame();
    });

    el('mode-help').addEventListener('click', () => {
      sound.tick();
      el('help-modal').hidden = false;
    });

    // The remaining cards each just open their mode's own modal; the mode
    // switches to the board itself once a match actually starts.
    el('mode-ai').addEventListener('click', () => {
      sound.tick();
      el('ai-modal').hidden = false;
      el('ai-leave').hidden = !this.ai.inMatch;
    });

    el('btn-menu').addEventListener('click', () => {
      sound.tick();
      this.leaveEverything();
      screens.show('menu');
      music.enterMenu();
    });
  }

  /** Abandon whatever was running. Called on the way back to the menu so a
   *  half-finished campaign chapter or Mania run cannot keep driving the
   *  board from behind the menu screen. */
  private leaveEverything(): void {
    window.dispatchEvent(new CustomEvent('cheskers:leave-modes'));
    this.ai.leave();
    this.lobby.leave();
    resetHorror();
    this.app.setBinding({ control: 'both' });
    this.app.resetForMatch({ ...DEFAULT_RULES });
    this.app.setModeLabel('LOCAL GAME');
    this.app.setModePanel(null);
  }
}
