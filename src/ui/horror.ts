/** The campaign's slow turn from "quiet chess club" to "something is wrong".
 *
 * One number drives everything: `level`, 0 through 7. Nothing here is a jump
 * scare — the board desaturates, the wood goes bone then meat, the panels lose
 * their blue, the room starts breathing, and the music drops a little flat.
 * By the time a player notices, they have been looking at it for a while.
 */

import {
  BASE_PALETTE,
  type Palette,
  desaturate,
  mixHex,
  palette,
} from '../render/theme';
import { music } from './music';

export const MAX_HORROR = 7;

/** Where each palette entry ends up at full horror. */
const TERMINAL: Partial<Palette> = {
  ink: '#0a0708',
  inkSoft: '#140d0f',
  panel: '#1d1315',
  panelHi: '#2a1b1d',
  edge: '#050303',

  // Bone, then old meat. This is the pair a player actually stares at.
  squareLight: '#b9ac97',
  squareDark: '#5e3730',

  cream: '#d8cec6',
  muted: '#7a6a68',

  white: '#ded8d4',
  steel: '#6f6570',

  red: '#e02436',
  gold: '#c8912c',
  green: '#5f8f5c',
  blue: '#5c6685',
};

/** Colour temperature is not enough on its own; the board also loses its
 *  saturation faster than the UI does, which is what makes the pieces start
 *  to look like objects rather than toys. */
const BOARD_KEYS: ReadonlyArray<keyof Palette> = ['squareLight', 'squareDark'];

let current = 0;

export function horrorLevel(): number {
  return current;
}

export function setHorror(level: number): void {
  current = Math.max(0, Math.min(MAX_HORROR, level));
  const t = current / MAX_HORROR;

  for (const key of Object.keys(BASE_PALETTE) as (keyof Palette)[]) {
    const base = BASE_PALETTE[key];
    const end = TERMINAL[key] ?? base;
    let value = mixHex(base, end, t);
    if (BOARD_KEYS.includes(key)) value = desaturate(value, t * 0.55);
    palette[key] = value;
  }

  // The CSS shell follows the same palette so the frame around the board does
  // not stay cheerfully blue while the board itself rots.
  const root = document.documentElement;
  root.style.setProperty('--ink', palette.ink);
  root.style.setProperty('--ink-soft', palette.inkSoft);
  root.style.setProperty('--panel', palette.panel);
  root.style.setProperty('--panel-hi', palette.panelHi);
  root.style.setProperty('--edge', palette.edge);
  root.style.setProperty('--cream', palette.cream);
  root.style.setProperty('--muted', palette.muted);
  root.style.setProperty('--red', palette.red);
  root.style.setProperty('--gold', palette.gold);
  root.style.setProperty('--green', palette.green);
  root.style.setProperty('--blue', palette.blue);

  // Discrete attribute for the effects CSS can do better than JS: vignette,
  // grain, the text flicker.
  root.dataset.horror = String(current);

  // Detune the music rather than swapping tracks -- the same song going
  // slightly wrong is worse than a different song.
  music.setDetune(1 - t * 0.06);
}

export function resetHorror(): void {
  setHorror(0);
  delete document.documentElement.dataset.horror;
}
