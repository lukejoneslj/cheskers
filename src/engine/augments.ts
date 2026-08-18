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
    id: 'missionary_bishop',
    name: 'MISSIONARIES',
    blurb: 'Your bishops may also step one square orthogonally.',
    rarity: 'common',
    glyph: '✝',
  },
  {
    id: 'warlord',
    name: 'WARLORD',
    blurb: 'Your king also moves as a knight.',
    rarity: 'common',
    glyph: '♞',
  },
  {
    id: 'swarm',
    name: 'SWARM',
    blurb: 'Checkers on their home rank may open with a two-square advance.',
    rarity: 'common',
    glyph: '⏩',
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
    id: 'heartstone',
    name: 'HEARTSTONE',
    blurb: 'Every checker of yours has a spare life. Attacks bounce off.',
    rarity: 'rare',
    glyph: '♥',
  },
  {
    id: 'veterancy',
    name: 'VETERANCY',
    blurb: 'Pieces bank kills: 2 earns a spare life, 3 earns a step any way.',
    rarity: 'rare',
    glyph: '✚',
  },
  {
    id: 'raider_knight',
    name: 'RAIDERS',
    blurb: 'Your knights may hop adjacent enemies any direction — and chain.',
    rarity: 'rare',
    glyph: '⚔',
  },
  {
    id: 'aegis',
    name: 'AEGIS',
    blurb: 'Both your rooks turn aside the first attempt on them. The attacker dies.',
    rarity: 'rare',
    glyph: '🛡',
  },
  {
    id: 'phalanx',
    name: 'PHALANX',
    blurb: 'Your checkers standing beside another of yours cannot be hopped.',
    rarity: 'rare',
    glyph: '⛓',
  },
  {
    id: 'reaping',
    name: 'REAPING',
    blurb: 'Every third piece you take raises a fresh man on your home rank.',
    rarity: 'rare',
    glyph: '⚱',
  },
  {
    id: 'stonewall',
    name: 'STONEWALL',
    blurb: 'Your checkers cannot be captured by a chess piece — only by a hop.',
    rarity: 'rare',
    glyph: '🧱',
  },
  {
    id: 'bounty',
    name: 'BOUNTY',
    blurb: 'Taking any chess piece raises a fresh checker on your home rank.',
    rarity: 'rare',
    glyph: '⚜',
  },
  {
    id: 'last_stand',
    name: 'LAST STAND',
    blurb: 'Down to 3 pieces or fewer, your checkers can move and hop any way.',
    rarity: 'rare',
    glyph: '🚩',
  },
  {
    id: 'grenadier',
    name: 'GRENADIER',
    blurb: 'Both your rooks arm on a 3-turn fuse. The blast hits friend and foe alike.',
    rarity: 'rare',
    glyph: '💥',
  },
  {
    id: 'gambler',
    name: 'GAMBLER',
    blurb: 'Drafting this deals you into one hand of blackjack for a prize — or a price.',
    rarity: 'rare',
    glyph: '🂡',
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
  {
    id: 'ascension',
    name: 'ASCENSION',
    blurb: 'Each kill promotes the killer: checker → knight → bishop → rook → queen.',
    rarity: 'cursed',
    glyph: '⇧',
  },
  {
    id: 'powder_keg',
    name: 'POWDER KEG',
    blurb: 'One checker is armed. It levels every neighbour when taken, or in six turns.',
    rarity: 'cursed',
    glyph: '💣',
  },
  {
    id: 'gorge',
    name: 'GORGE',
    blurb: 'Every kill stacks another spare life onto the piece that made it.',
    rarity: 'cursed',
    glyph: '⬆',
  },
  {
    id: 'ironclad',
    name: 'IRONCLAD',
    blurb: 'Every chess piece of yours but the King has a spare life.',
    rarity: 'cursed',
    glyph: '⛊',
  },
  {
    id: 'martyr',
    name: 'MARTYRS',
    blurb: 'Every checker of yours levels its neighbours when it is taken.',
    rarity: 'cursed',
    glyph: '✹',
  },
  {
    id: 'volatile',
    name: 'VOLATILE',
    blurb: 'Every checker of yours has a 1-in-4 chance to blow its neighbourhood when killed.',
    rarity: 'cursed',
    glyph: '☢',
  },
  {
    id: 'loaded_dice',
    name: 'LOADED DICE',
    blurb: 'Roll a d10 each of your turns: a 10 blesses a checker, a 1 costs one a life.',
    rarity: 'cursed',
    glyph: '🎲',
  },
  {
    id: 'questline',
    name: 'QUESTLINE',
    blurb: 'Survive two more rounds holding this and it pays out a powerful augment, free.',
    rarity: 'cursed',
    glyph: '📜',
  },
];

const BY_ID = new Map(AUGMENTS.map((a) => [a.id, a]));

export function augment(id: AugmentId): Augment {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`unknown augment: ${id}`);
  return found;
}

/** How many of a draft's cards are guaranteed common, floor kept low. A card
 *  you can always predict the shape of is what makes the wildcard slot feel
 *  like a wildcard rather than a coin flip on whether you get to play at all. */
const GUARANTEED_COMMONS = 2;

/** Deal `count` distinct augments the player does not already hold.
 *
 * When there is room for it (`count` is at least `GUARANTEED_COMMONS + 1`),
 * the first cards are always common and only the remainder is weighted --
 * so a draft of three is never a coin flip on getting *any* playable card,
 * and the one wildcard slot is where the run's escalation actually shows up.
 * Later rounds weight that wildcard toward the nastier end of the pool. */
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

  const takeWeighted = (from: Augment[]): number => {
    const total = from.reduce((n, a) => n + weight(a), 0);
    let roll = Math.random() * total;
    for (let i = 0; i < from.length; i++) {
      roll -= weight(from[i]!);
      if (roll <= 0) return i;
    }
    return from.length - 1;
  };

  const guaranteed = count > GUARANTEED_COMMONS ? GUARANTEED_COMMONS : 0;
  while (picked.length < guaranteed) {
    const commons = remaining.filter((a) => a.rarity === 'common');
    if (commons.length === 0) break; // pool has run dry of commons; fall through
    const choice = commons[Math.floor(Math.random() * commons.length)]!;
    picked.push(choice);
    remaining.splice(remaining.indexOf(choice), 1);
  }

  while (picked.length < count && remaining.length > 0) {
    const index = takeWeighted(remaining);
    picked.push(remaining[index]!);
    remaining.splice(index, 1);
  }
  return picked;
}
