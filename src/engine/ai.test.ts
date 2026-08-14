import { describe, expect, it } from 'vitest';

import { chooseMove, DIFFICULTIES } from './ai';
import { applyMove, initialState, legalMoves } from './rules';
import {
  type Color,
  type GameState,
  type Kind,
  type Piece,
  DEFAULT_RULES,
  sq,
} from './types';

/** Same sparse-position builder as rules.test.ts. */
function position(spec: Record<string, string>, overrides: Partial<GameState> = {}): GameState {
  const board: (Piece | null)[] = Array(64).fill(null);
  let id = 0;
  for (const [name, code] of Object.entries(spec)) {
    const file = 'abcdefgh'.indexOf(name[0]!);
    const rank = Number(name[1]);
    const color = code[0] as Color;
    const raw = code[1]!;
    const kinged = raw === 'C';
    const kind = (kinged ? 'c' : raw) as Kind;
    board[sq(8 - rank, file)] = { kind, color, kinged, id: id++ };
  }
  return {
    board,
    turn: 'w',
    chain: null,
    status: 'playing',
    winner: null,
    winReason: null,
    history: [],
    rules: DEFAULT_RULES,
    nextId: id,
    ...overrides,
  };
}

const S = (name: string) => sq(8 - Number(name[1]), 'abcdefgh'.indexOf(name[0]!));

// A fast difficulty for tests -- deep enough to exercise real search without
// spending real wall-clock time on every assertion.
const FAST = { label: 'test', maxDepth: 4, timeBudgetMs: 300, randomness: 0 };

describe('chooseMove', () => {
  it('returns null when there are no legal moves', () => {
    const s: GameState = { ...initialState(), status: 'over', winner: 'w', winReason: 'king-capture' };
    expect(chooseMove(s, FAST)).toBeNull();
  });

  it('returns the only legal move without searching', () => {
    const s = position({ a1: 'wK', h8: 'bK' }, { turn: 'w' });
    const move = chooseMove(s, FAST);
    expect(move).not.toBeNull();
    expect(legalMoves(s)).toContainEqual(move);
  });

  it('always returns a legal move from a busy position', () => {
    const s = initialState();
    const move = chooseMove(s, FAST);
    expect(move).not.toBeNull();
    expect(legalMoves(s).some((m) => m.from === move!.from && m.to === move!.to)).toBe(true);
  });

  it('takes a free king when it can', () => {
    // White queen one step from the black king, nothing else on the board --
    // any real search finds the immediate win.
    const s = position({ d1: 'wQ', a8: 'wK', d8: 'bK' }, { turn: 'w' });
    const move = chooseMove(s, FAST)!;
    expect(move.to).toBe(S('d8'));
    const after = applyMove(s, move);
    expect(after.status).toBe('over');
    expect(after.winner).toBe('w');
  });

  it('avoids a move that hands over the king next turn', () => {
    const s = position({ e4: 'wK', h4: 'bR', a1: 'wR', a8: 'bK' }, { turn: 'w' });
    const move = chooseMove(s, FAST)!;
    const after = applyMove(s, move);
    // Whatever White plays, Black must not have an immediate king-capturing
    // reply available.
    const blackReplyCaptures = legalMoves(after).some(
      (m) => m.captured !== null && after.board[m.captured]?.kind === 'K',
    );
    expect(blackReplyCaptures).toBe(false);
  });

  it('keeps moving the same piece through a forced jump chain', () => {
    // A double-hop for White's checker: b4 lands on a chain that must
    // continue rather than switching to another piece.
    const s = position(
      { b4: 'wc', c5: 'bc', e7: 'bc', a1: 'wK', h8: 'bK' },
      { turn: 'w', rules: { ...DEFAULT_RULES, forcedJumps: true } },
    );
    const move = chooseMove(s, FAST)!;
    expect(move.isJump).toBe(true);
  });

  it('respects its time budget', () => {
    const s = initialState();
    const budget = 200;
    const start = performance.now();
    chooseMove(s, { label: 'timed', maxDepth: 12, timeBudgetMs: budget, randomness: 0 });
    const elapsed = performance.now() - start;
    // Generous slack: the deadline is only checked every 1024 nodes, and one
    // full root iteration always completes even if it overruns slightly.
    expect(elapsed).toBeLessThan(budget * 6);
  });

  it('easy difficulty is at least occasionally random across many draws', () => {
    const s = initialState();
    const moves = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const m = chooseMove(s, DIFFICULTIES.easy)!;
      moves.add(`${m.from}-${m.to}`);
    }
    // With 25% randomness and the position wide open, twenty draws should not
    // all land on the exact same move.
    expect(moves.size).toBeGreaterThan(1);
  });
});
