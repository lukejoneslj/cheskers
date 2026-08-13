/** Elo ratings, following the same shape the major chess sites use.
 *
 * Pure arithmetic, no storage and no Firebase: that keeps it unit-testable and
 * lets both clients compute the identical result from the identical inputs,
 * which matters because each client writes only its own rating.
 */

export const STARTING_RATING = 1200;
/** Ratings are clamped here so a long losing run cannot drive someone absurdly
 *  low, matching the floor most public ladders use. */
export const RATING_FLOOR = 100;

export type Outcome = 'win' | 'loss' | 'draw';

export interface RatingSnapshot {
  rating: number;
  /** Completed rated games. Drives the K-factor. */
  games: number;
}

/** Score for the Elo formula: 1 for a win, ½ for a draw, 0 for a loss. */
export function scoreOf(outcome: Outcome): number {
  return outcome === 'win' ? 1 : outcome === 'draw' ? 0.5 : 0;
}

/** Probability that `rating` beats `opponent`, per the logistic Elo curve. */
export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

/** How far a single game can move a rating.
 *
 * New players move fast so their rating finds its level quickly; established
 * players move slowly so it stays stable; strong players move slowest of all,
 * which is the convention that keeps the top of a ladder from thrashing.
 */
export function kFactor(snapshot: RatingSnapshot): number {
  if (snapshot.games < 30) return 40;
  if (snapshot.rating >= 2400) return 10;
  return 20;
}

/** The largest swing any single game may produce. The database rules use this
 *  to bound what a client is allowed to write to its own rating. */
export const MAX_DELTA = 40;

export interface RatingChange {
  before: number;
  after: number;
  delta: number;
  expected: number;
  k: number;
}

/** Compute one player's new rating after a game. */
export function rate(
  player: RatingSnapshot,
  opponent: RatingSnapshot,
  outcome: Outcome,
): RatingChange {
  const expected = expectedScore(player.rating, opponent.rating);
  const k = kFactor(player);
  // Round away from zero so a narrowly-earned point is never silently lost to
  // truncation; a win must always be worth at least one point.
  const raw = k * (scoreOf(outcome) - expected);
  let delta = raw >= 0 ? Math.round(raw) : -Math.round(-raw);
  if (outcome === 'win' && delta < 1) delta = 1;
  if (outcome === 'loss' && delta > -1) delta = -1;

  const after = Math.max(RATING_FLOOR, player.rating + delta);
  return {
    before: player.rating,
    after,
    delta: after - player.rating,
    expected,
    k,
  };
}

/** Flip an outcome to the other player's point of view. */
export function invert(outcome: Outcome): Outcome {
  return outcome === 'win' ? 'loss' : outcome === 'loss' ? 'win' : 'draw';
}

/** Coarse rank band, used for the badge next to a player's name. */
export function rankOf(rating: number): { title: string; tier: string } {
  if (rating >= 2400) return { title: 'MASTER', tier: 'master' };
  if (rating >= 2000) return { title: 'EXPERT', tier: 'expert' };
  if (rating >= 1600) return { title: 'ADEPT', tier: 'adept' };
  if (rating >= 1300) return { title: 'PLAYER', tier: 'player' };
  if (rating >= 1000) return { title: 'NOVICE', tier: 'novice' };
  return { title: 'ROOKIE', tier: 'rookie' };
}
