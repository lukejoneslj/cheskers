/** Which full-page screen is showing.
 *
 * Three of them, in order: the title video, the mode menu, and the board.
 * Keeping this in one place means no module has to know how any other screen
 * is hidden — they just ask for the one they want.
 */

export type ScreenName = 'menu' | 'game';

class Screens {
  private current: ScreenName | null = null;

  get active(): ScreenName | null {
    return this.current;
  }

  show(name: ScreenName): void {
    if (this.current === name) return;
    this.current = name;
    const menu = document.getElementById('menu');
    const app = document.getElementById('app');
    if (menu) menu.hidden = name !== 'menu';
    if (app) app.hidden = name !== 'game';

    if (name === 'game') {
      // The board was sized while `#app` had no layout at all, so its measured
      // width was zero. Nudge it now that the element is actually on screen.
      window.dispatchEvent(new Event('resize'));
    }
    window.scrollTo(0, 0);
  }
}

export const screens = new Screens();
