/** The augment catalogue for Cheskers Mania.
 *
 * Every entry here is already implemented inside `rules.ts` — this module is
 * only the presentation layer (names, blurbs, rarity) plus the draft helpers.
 * Keeping the behaviour in the engine is what lets the AI play with and
 * against augments without knowing they exist.
 */

import type { AugmentId } from './types';

export type Rarity = 'common' | 'rare' | 'cursed';

export interface Augment {
  id: AugmentId;
  name: string;
  /** One line, written to be read at a glance mid-draft. */
  blurb: string;
  rarity: Rarity;
  /** Single glyph shown on the draft card. */
  glyph: string;
}

export const AUGMENTS: ReadonlyArray<Augment> = [
  {
    id: 'backpedal',
    name: 'BACKPEDAL',
    blurb: 'Your checkers may move and hop backwards, crowned or not.',
    rarity: 'common',
    glyph: '↺',
  },
  {
    id: 'flank',
    name: 'FLANK',
    blurb: 'Your checkers may also step and hop sideways.',
    rarity: 'common',
    glyph: '↔',
  },
  {
    id: 'early_crown',
    name: 'EARLY CROWN',
    blurb: 'Your checkers crown one rank sooner.',
    rarity: 'common',
    glyph: '♛',
  },
  {
    id: 'siege_rook',
    name: 'SIEGE ENGINE',
    blurb: 'Your rooks may also step one square diagonally.',
    rarity: 'common',
    glyph: '♜',
  },
  {
    id: 'outrider_knight',
    name: 'OUTRIDERS',
    blurb: 'Your knights may also step one square in any direction.',
    rarity: 'common',
    glyph: '♞',
  },
  {
    id: 'relentless',
    name: 'RELENTLESS',
    blurb: 'Crowning no longer ends your jump chain. Keep going.',
    rarity: 'rare',
    glyph: '∞',
  },
  {
    id: 'zealot_bishop',
    name: 'ZEALOTS',
    blurb: 'Your bishops may hop adjacent enemies like checkers — and chain.',
    rarity: 'rare',
    glyph: '♝',
  },
  {
    id: 'blink_king',
    name: 'BLINK',
    blurb: 'Your king may leap exactly two squares, over anything.',
    rarity: 'rare',
    glyph: '✦',
  },
  {
    id: 'undying',
    name: 'UNDYING',
    blurb: 'The first checker you lose climbs back out on your home rank.',
    rarity: 'rare',
    glyph: '☩',
  },
  {
    id: 'flying_kings',
    name: 'FLYING KINGS',
    blurb: 'Your crowned checkers slide any distance and take from range.',
    rarity: 'cursed',
    glyph: '✧',
  },
  {
    id: 'amazon_queen',
    name: 'AMAZON',
    blurb: 'Your queen also moves as a knight.',
    rarity: 'cursed',
    glyph: '♕',
  },
  {
    id: 'royal_guard',
    name: 'ROYAL GUARD',
    blurb: 'Your king turns aside the first attempt on it. The attacker dies.',
    rarity: 'cursed',
    glyph: '⛨',
  },
  {
    id: 'bloodcrown',
    name: 'BLOODCROWN',
    blurb: 'Any checker of yours that captures is crowned on the spot.',
    rarity: 'cursed',
    glyph: '☠',
  },
];

const BY_ID = new Map(AUGMENTS.map((a) => [a.id, a]));

export function augment(id: AugmentId): Augment {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`unknown augment: ${id}`);
  return found;
}

/** Deal `count` distinct augments the player does not already hold.
 *  Later rounds weight the draft toward the nastier end of the pool, so a run
 *  visibly escalates rather than staying flat. */
export function draft(
  held: ReadonlyArray<AugmentId>,
  count: number,
  round: number,
): Augment[] {
  const pool = AUGMENTS.filter((a) => !held.includes(a.id));
  const weight = (a: Augment): number => {
    if (a.rarity === 'common') return Math.max(1, 6 - round);
    if (a.rarity === 'rare') return 4;
    return Math.min(6, round); // cursed: rare early, common late
  };

  const picked: Augment[] = [];
  const remaining = [...pool];
  while (picked.length < count && remaining.length > 0) {
    const total = remaining.reduce((n, a) => n + weight(a), 0);
    let roll = Math.random() * total;
    let index = remaining.length - 1;
    for (let i = 0; i < remaining.length; i++) {
      roll -= weight(remaining[i]!);
      if (roll <= 0) {
        index = i;
        break;
      }
    }
    picked.push(remaining[index]!);
    remaining.splice(index, 1);
  }
  return picked;
}
