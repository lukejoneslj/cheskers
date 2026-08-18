/** Title screen: looping video backdrop, START GAME button, white-fade
 *  handoff into the main app. Music for the title and the "selecting game
 *  mode" screen that follows it lives here too, since this is the one place
 *  that gesture (the button click) is guaranteed to exist. */

import { music } from './music';
import { screens } from './screens';
import { sound } from './sound';

const FADE_MS = 420;

export class TitleScreen {
  private readonly screen = document.getElementById('title-screen')!;
  private readonly video = document.getElementById('title-video') as HTMLVideoElement;
  private readonly fade = document.getElementById('title-fade') as HTMLDivElement;
  private readonly startBtn = document.getElementById('title-start') as HTMLButtonElement;

  constructor() {
    // An invite link (/?room=ABCD) skips the title outright. Somebody who was
    // sent a link is already past the "do you want to play" question, and
    // making them sit through the loop and press START to reach the room they
    // were invited to is a door in front of an open door.
    if (new URLSearchParams(window.location.search).get('room')) {
      this.screen.hidden = true;
      this.video.removeAttribute('src');
      screens.show('menu');
      music.enterMenu();
      return;
    }

    this.video.src = `${import.meta.env.BASE_URL}video/title.mp4`;

    // Autoplay-with-sound is routinely blocked before any gesture. Try right
    // away -- it works in plenty of browsers -- and fall back to starting on
    // the first tap/click/key anywhere on the title screen otherwise.
    music.playTitle();
    const tryUnlock = () => {
      music.unlock();
      this.screen.removeEventListener('pointerdown', tryUnlock);
      this.screen.removeEventListener('keydown', tryUnlock);
    };
    this.screen.addEventListener('pointerdown', tryUnlock);
    this.screen.addEventListener('keydown', tryUnlock);

    this.startBtn.addEventListener('click', () => this.enter());
  }

  private enter(): void {
    sound.unlock();
    sound.tick();
    music.unlock();
    music.enterMenu();

    // A quick white flash reads as a natural cut between the cinematic loop
    // and the pixel-art board rather than a jarring hard swap.
    this.fade.hidden = false;
    requestAnimationFrame(() => this.fade.classList.add('title-fade-in'));

    window.setTimeout(() => {
      // The title hands off to the mode menu, not straight to the board.
      screens.show('menu');

      window.setTimeout(() => {
        this.fade.classList.remove('title-fade-in');
        this.fade.classList.add('title-fade-out');
        this.screen.hidden = true;
        this.video.pause();
        this.video.removeAttribute('src');
        this.video.load();

        window.setTimeout(() => {
          this.fade.hidden = true;
          this.fade.classList.remove('title-fade-out');
        }, FADE_MS);
      }, 60);
    }, FADE_MS);
  }
}
