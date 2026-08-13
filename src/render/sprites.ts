/** Sprite atlas loading and per-piece metrics.
 *
 * Both source sheets are reduced to a single shared pixel grid by
 * `tools/extract_sprites.py`, so every sprite here is measured in the same
 * "art unit". One art unit maps to `scale` device pixels at draw time, which is
 * always an integer -- that is what keeps the pixel art crisp instead of
 * smeared.
 */

import type { Color, Kind, Piece } from '../engine/types';

/** A board square is 24 art units across. The tallest sprite is 21 units, so
 *  this leaves a little breathing room on every side. */
export const SQUARE_UNITS = 24;
export const BOARD_UNITS = SQUARE_UNITS * 8;

const CHESS_FILE: Record<Exclude<Kind, 'c'>, string> = {
  R: 'rook',
  N: 'knight',
  B: 'bishop',
  Q: 'queen',
  K: 'king',
};

export interface Sprite {
  image: HTMLImageElement;
  w: number;
  h: number;
}

export type SpriteKey = string;

export function spriteKey(piece: Pick<Piece, 'kind' | 'color' | 'kinged'>): SpriteKey {
  if (piece.kind === 'c') {
    return `checkers_${piece.color}_${piece.kinged ? 'king' : 'man'}`;
  }
  return `chess_${piece.color}_${CHESS_FILE[piece.kind]}`;
}

function allKeys(): SpriteKey[] {
  const keys: SpriteKey[] = [];
  for (const color of ['w', 'b'] as Color[]) {
    for (const name of Object.values(CHESS_FILE)) keys.push(`chess_${color}_${name}`);
    keys.push(`checkers_${color}_man`, `checkers_${color}_king`);
  }
  return keys;
}

export class SpriteAtlas {
  private readonly sprites = new Map<SpriteKey, Sprite>();

  get(key: SpriteKey): Sprite | null {
    return this.sprites.get(key) ?? null;
  }

  async load(base = 'sprites'): Promise<void> {
    await Promise.all(
      allKeys().map(
        (key) =>
          new Promise<void>((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
              this.sprites.set(key, {
                image,
                w: image.naturalWidth,
                h: image.naturalHeight,
              });
              resolve();
            };
            image.onerror = () => reject(new Error(`missing sprite: ${key}.png`));
            image.src = `${import.meta.env.BASE_URL}${base}/${key}.png`;
          }),
      ),
    );
  }
}
