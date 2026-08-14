import { AccountPanel } from './ui/account';
import { AiMatch } from './ui/ai-match';
import { App } from './ui/app';
import { Lobby } from './ui/lobby';
import { TitleScreen } from './ui/title';

const app = new App();
new TitleScreen();

app
  .start()
  .then(() => {
    // The lobby is constructed after the board is live so that a deep link
    // (/?room=ABCD) has a working game to attach to.
    new AccountPanel();
    const lobby = new Lobby(app);
    const aiMatch = new AiMatch(app);
    // Online play and the AI both take exclusive ownership of the board;
    // each yields to the other before starting its own match.
    lobby.setPeer(aiMatch);
    aiMatch.setPeer(lobby);
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
