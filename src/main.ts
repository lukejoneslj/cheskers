import { AccountPanel } from './ui/account';
import { App } from './ui/app';
import { Lobby } from './ui/lobby';

const app = new App();

app
  .start()
  .then(() => {
    // The lobby is constructed after the board is live so that a deep link
    // (/?room=ABCD) has a working game to attach to.
    new AccountPanel();
    new Lobby(app);
  })
  .catch((error: unknown) => {
    console.error(error);
    const banner = document.getElementById('banner-text');
    if (banner) banner.textContent = 'FAILED TO LOAD';
  });

// Handy during development and for the multiplayer layer to attach to.
declare global {
  interface Window {
    cheskers: App;
  }
}
window.cheskers = app;
