import { describe, expect, it } from 'vitest';

import {
  MAX_DELTA,
  RATING_FLOOR,
  STARTING_RATING,
  expectedScore,
  invert,
  kFactor,
  rankOf,
  rate,
  scoreOf,
} from './elo';

const player = (rating: number, games = 50) => ({ rating, games });

describe('expected score', () => {
  it('is even between equal ratings', () => {
    expect(expectedScore(1500, 1500)).toBeCloseTo(0.5, 10);
  });

  it('gives a 400-point favourite about ten to one', () => {
    expect(expectedScore(1900, 1500)).toBeCloseTo(10 / 11, 6);
  });

  it('is symmetric — both expectations sum to one', () => {
    for (const [a, b] of [[1200, 1400], [1000, 2600], [1750, 1750]]) {
      expect(expectedScore(a!, b!) + expectedScore(b!, a!)).toBeCloseTo(1, 10);
    }
  });
});

describe('k-factor', () => {
  it('is largest for provisional players', () => {
    expect(kFactor(player(1200, 0))).toBe(40);
    expect(kFactor(player(1200, 29))).toBe(40);
  });

  it('settles once a player is established', () => {
    expect(kFactor(player(1200, 30))).toBe(20);
  });

  it('is smallest at master level', () => {
    expect(kFactor(player(2400, 200))).toBe(10);
    // Provisional status still takes precedence over a high rating.
    expect(kFactor(player(2400, 5))).toBe(40);
  });
});

describe('rating a game', () => {
  it('splits the k-factor evenly when equals draw', () => {
    expect(rate(player(1500), player(1500), 'draw').delta).toBe(0);
  });

  it('awards half the k-factor when equals decide it', () => {
    expect(rate(player(1500), player(1500), 'win').delta).toBe(10);
    expect(rate(player(1500), player(1500), 'loss').delta).toBe(-10);
  });

  it('pays little for beating a much weaker player', () => {
    const change = rate(player(2000), player(1200), 'win');
    expect(change.delta).toBeGreaterThan(0);
    expect(change.delta).toBeLessThanOrEqual(2);
  });

  it('pays heavily for an upset', () => {
    const change = rate(player(1200), player(2000), 'win');
    expect(change.delta).toBeGreaterThan(15);
  });

  it('punishes losing to a much weaker player', () => {
    expect(rate(player(2000), player(1200), 'loss').delta).toBeLessThan(-15);
  });

  it('always moves a decisive game by at least a point', () => {
    // A 900-point favourite would otherwise round to a zero-point win.
    expect(rate(player(2400, 300), player(1000), 'win').delta).toBe(1);
    expect(rate(player(1000), player(2400, 300), 'loss').delta).toBe(-1);
  });

  it('never exceeds the bound the database rules enforce', () => {
    for (let a = 400; a <= 2800; a += 100) {
      for (let b = 400; b <= 2800; b += 100) {
        for (const outcome of ['win', 'loss', 'draw'] as const) {
          for (const games of [0, 40, 300]) {
            const { delta } = rate({ rating: a, games }, { rating: b, games }, outcome);
            expect(Math.abs(delta)).toBeLessThanOrEqual(MAX_DELTA);
          }
        }
      }
    }
  });

  it('is very nearly zero-sum between equally established players', () => {
    const a = player(1650, 100);
    const b = player(1420, 100);
    const win = rate(a, b, 'win');
    const loss = rate(b, a, 'loss');
    expect(win.delta + loss.delta).toBe(0);
  });

  it('will not push a rating below the floor', () => {
    const change = rate(player(RATING_FLOOR, 0), player(2500), 'loss');
    expect(change.after).toBe(RATING_FLOOR);
    expect(change.delta).toBe(0);
  });

  it('converges towards a player’s true strength', () => {
    // A 1200-rated newcomer who consistently beats 1600s should climb past them.
    let me = { rating: STARTING_RATING, games: 0 };
    for (let i = 0; i < 40; i++) {
      const change = rate(me, player(1600), 'win');
      me = { rating: change.after, games: me.games + 1 };
    }
    expect(me.rating).toBeGreaterThan(1600);
  });
});

describe('helpers', () => {
  it('scores outcomes conventionally', () => {
    expect(scoreOf('win')).toBe(1);
    expect(scoreOf('draw')).toBe(0.5);
    expect(scoreOf('loss')).toBe(0);
  });

  it('inverts an outcome for the opponent', () => {
    expect(invert('win')).toBe('loss');
    expect(invert('loss')).toBe('win');
    expect(invert('draw')).toBe('draw');
  });

  it('bands ratings into ranks that never overlap', () => {
    expect(rankOf(900).title).toBe('ROOKIE');
    expect(rankOf(1200).title).toBe('NOVICE');
    expect(rankOf(1300).title).toBe('PLAYER');
    expect(rankOf(1600).title).toBe('ADEPT');
    expect(rankOf(2000).title).toBe('EXPERT');
    expect(rankOf(2400).title).toBe('MASTER');
  });
});
