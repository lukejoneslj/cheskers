/** One palette shared by the canvas renderer and the CSS shell.
 *
 * The hues are pulled from the sprite sheets themselves — the deep navy of the
 * piece outlines and the steel blue of the dark army — so the board, the panels
 * and the pieces read as a single set rather than art dropped onto a UI.
 */

export const palette = {
  ink: '#10121a',
  inkSoft: '#1a1e2c',
  panel: '#232840',
  panelHi: '#2f3757',
  edge: '#0b0d13',

  squareLight: '#e8cfa4',
  squareDark: '#a9784f',

  cream: '#f2e7d0',
  muted: '#8d93ad',

  white: '#f0f2f5',
  steel: '#6d8bb0',

  red: '#ff4d5f',
  gold: '#ffc93c',
  green: '#3ddc84',
  blue: '#4f9bff',
} as const;

/** Board-surface tints, kept semi-transparent so the wood grain shows through. */
export const overlay = {
  selected: 'rgba(255, 201, 60, 0.55)',
  lastMove: 'rgba(255, 201, 60, 0.26)',
  hover: 'rgba(255, 255, 255, 0.16)',
  moveDot: 'rgba(61, 220, 132, 0.92)',
  moveDotEdge: 'rgba(12, 60, 34, 0.55)',
  captureRing: '#ff4d5f',
  chain: '#4f9bff',
} as const;
