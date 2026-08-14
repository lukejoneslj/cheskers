/** One palette shared by the canvas renderer and the CSS shell.
 *
 * The hues are pulled from the sprite sheets themselves — the deep navy of the
 * piece outlines and the steel blue of the dark army — so the board, the panels
 * and the pieces read as a single set rather than art dropped onto a UI.
 *
 * The renderer reads `palette` fresh on every frame, so mutating it (see
 * `src/ui/horror.ts`) re-tints the board live with no other plumbing.
 */

export const BASE_PALETTE = {
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
};

export type Palette = typeof BASE_PALETTE;

/** The live palette. Mutable on purpose — never re-import or copy this if you
 *  want the board to keep following theme changes. */
export const palette: Palette = { ...BASE_PALETTE };

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

// ---------------------------------------------------------------------------
// Colour maths, used by the horror escalation
// ---------------------------------------------------------------------------

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${((1 << 24) | (clamp(r) << 16) | (clamp(g) << 8) | clamp(b))
    .toString(16)
    .slice(1)}`;
}

export function mixHex(from: string, to: string, t: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  return rgbToHex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  });
}

/** Push a colour toward its own grey, `amount` of the way. */
export function desaturate(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const grey = 0.299 * r + 0.587 * g + 0.114 * b;
  return rgbToHex({
    r: r + (grey - r) * amount,
    g: g + (grey - g) * amount,
    b: b + (grey - b) * amount,
  });
}
