import { describe, expect, it } from 'vitest';

import {
  applyMove,
  findMove,
  initialState,
  legalMoves,
  legalMovesFrom,
  movesForPiece,
  other,
  resign,
} from './rules';
import {
  type Board,
  type Color,
  type GameState,
  type Kind,
  type Piece,
  DEFAULT_RULES,
  sq,
  squareName,
} from './types';

/** Build a sparse position for testing. `spec` maps square name -> piece code,
 *  e.g. `{ e1: 'wK', d4: 'bc', c3: 'wC' }` where `C` is a crowned checker. */
function position(
  spec: Record<string, string>,
  overrides: Partial<GameState> = {},
): GameState {
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
const targets = (moves: { to: number }[]) => moves.map((m) => squareName(m.to)).sort();
const at = (b: Board, name: string) => b[S(name)] ?? null;

describe('initial position', () => {
  const s = initialState();

  it('sets up chess back ranks and checkers second ranks', () => {
    expect(at(s.board, 'a1')?.kind).toBe('R');
    expect(at(s.board, 'e1')?.kind).toBe('K');
    expect(at(s.board, 'd1')?.kind).toBe('Q');
    expect(at(s.board, 'a2')?.kind).toBe('c');
    expect(at(s.board, 'a2')?.color).toBe('w');
    expect(at(s.board, 'a8')?.color).toBe('b');
    expect(at(s.board, 'a7')?.kind).toBe('c');
  });

  it('gives every piece a unique id', () => {
    const ids = s.board.filter(Boolean).map((p) => p!.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(32);
  });

  it('opens with White to move and only checker advances available', () => {
    // Back rank is entirely blocked by the checker wall, so every opening move
    // is a checker step (or a knight hop, which can leap the wall).
    const moves = legalMoves(s);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => !m.isJump)).toBe(true);
    const knightMoves = legalMovesFrom(s, S('b1'));
    expect(targets(knightMoves)).toEqual(['a3', 'c3']);
  });
});

describe('chess movement', () => {
  it('slides a rook until blocked and captures the blocker', () => {
    const s = position({ a1: 'wR', a5: 'bc', a8: 'bR' });
    const moves = movesForPiece(s.board, S('a1'));
    expect(targets(moves)).toEqual(['a2', 'a3', 'a4', 'a5', 'b1', 'c1', 'd1',
      'e1', 'f1', 'g1', 'h1']);
    expect(moves.find((m) => m.to === S('a5'))?.captured).toBe(S('a5'));
  });

  it('stops a rook short of a friendly piece', () => {
    const s = position({ a1: 'wR', a3: 'wc' });
    expect(targets(movesForPiece(s.board, S('a1')))).toContain('a2');
    expect(targets(movesForPiece(s.board, S('a1')))).not.toContain('a3');
  });

  it('moves a knight in an L and ignores blockers', () => {
    const s = position({ d4: 'wN', d5: 'wc', e5: 'wc' });
    expect(targets(movesForPiece(s.board, S('d4')))).toEqual(
      ['b3', 'b5', 'c2', 'c6', 'e2', 'e6', 'f3', 'f5'],
    );
  });

  it('moves a bishop diagonally only', () => {
    const s = position({ c1: 'wB' });
    expect(targets(movesForPiece(s.board, S('c1')))).toEqual(
      ['a3', 'b2', 'd2', 'e3', 'f4', 'g5', 'h6'],
    );
  });

  it('gives the queen both rook and bishop lines', () => {
    const s = position({ d4: 'wQ' });
    expect(movesForPiece(s.board, S('d4')).length).toBe(27);
  });

  it('moves the king one square in any direction', () => {
    const s = position({ d4: 'wK' });
    expect(targets(movesForPiece(s.board, S('d4')))).toEqual(
      ['c3', 'c4', 'c5', 'd3', 'd5', 'e3', 'e4', 'e5'],
    );
  });

  it('lets a chess piece capture a checker', () => {
    const s = position({ d1: 'wQ', d7: 'bc' });
    const move = findMove(s, S('d1'), S('d7'));
    expect(move?.captured).toBe(S('d7'));
    const next = applyMove(s, move!);
    expect(at(next.board, 'd7')?.color).toBe('w');
  });
});

describe('checker movement', () => {
  it('steps diagonally forward only', () => {
    const s = position({ d4: 'wc' });
    expect(targets(movesForPiece(s.board, S('d4')))).toEqual(['c5', 'e5']);
  });

  it('sends Black checkers down the board', () => {
    const s = position({ d4: 'bc' }, { turn: 'b' });
    expect(targets(movesForPiece(s.board, S('d4')))).toEqual(['c3', 'e3']);
  });

  it('lets a crowned checker move in all four diagonals', () => {
    const s = position({ d4: 'wC' });
    expect(targets(movesForPiece(s.board, S('d4')))).toEqual(
      ['c3', 'c5', 'e3', 'e5'],
    );
  });

  it('hops an adjacent enemy onto the empty square beyond', () => {
    const s = position({ d4: 'wc', e5: 'bc' });
    const move = findMove(s, S('d4'), S('f6'));
    expect(move).toBeTruthy();
    expect(move!.isJump).toBe(true);
    expect(move!.captured).toBe(S('e5'));
  });

  it('cannot hop when the landing square is occupied', () => {
    const s = position({ d4: 'wc', e5: 'bc', f6: 'bc' });
    expect(findMove(s, S('d4'), S('f6'))).toBeNull();
  });

  it('cannot hop a friendly piece', () => {
    const s = position({ d4: 'wc', e5: 'wc' });
    expect(targets(movesForPiece(s.board, S('d4')))).toEqual(['c5']);
  });

  it('can hop a chess piece, not just another checker', () => {
    const s = position({ d4: 'wc', e5: 'bR' });
    const move = findMove(s, S('d4'), S('f6'));
    expect(move?.captured).toBe(S('e5'));
    const next = applyMove(s, move!);
    expect(at(next.board, 'e5')).toBeNull();
  });
});

describe('compulsory capture', () => {
  it('restricts the mover to hops when one is available', () => {
    const s = position({ d4: 'wc', e5: 'bc', a1: 'wR' });
    const moves = legalMoves(s);
    expect(moves.every((m) => m.isJump)).toBe(true);
    expect(targets(moves)).toEqual(['f6']);
  });

  it('allows any move when the rule is switched off', () => {
    const s = position(
      { d4: 'wc', e5: 'bc', a1: 'wR' },
      { rules: { ...DEFAULT_RULES, forcedJumps: false } },
    );
    const moves = legalMoves(s);
    expect(moves.some((m) => !m.isJump)).toBe(true);
    expect(moves.some((m) => m.isJump)).toBe(true);
  });
});

describe('multi-jump chains', () => {
  it('keeps the turn and locks to the jumping piece', () => {
    const s = position({ b2: 'wc', c3: 'bc', e5: 'bc' });
    const next = applyMove(s, findMove(s, S('b2'), S('d4'))!);
    expect(next.turn).toBe('w');
    expect(next.chain).toBe(S('d4'));
    // Only the chaining piece may move, and only by hopping again.
    const moves = legalMoves(next);
    expect(moves.every((m) => m.from === S('d4') && m.isJump)).toBe(true);
    expect(targets(moves)).toEqual(['f6']);
  });

  it('ends the turn once no further hop exists', () => {
    const s = position({ b2: 'wc', c3: 'bc' });
    const next = applyMove(s, findMove(s, S('b2'), S('d4'))!);
    expect(next.chain).toBeNull();
    expect(next.turn).toBe('b');
  });

  it('records the second hop as chained', () => {
    const s = position({ b2: 'wc', c3: 'bc', e5: 'bc' });
    const mid = applyMove(s, findMove(s, S('b2'), S('d4'))!);
    const end = applyMove(mid, findMove(mid, S('d4'), S('f6'))!);
    expect(end.history.map((h) => h.chained)).toEqual([false, true]);
    expect(end.turn).toBe('b');
  });
});

describe('crowning', () => {
  it('crowns a checker reaching the far rank', () => {
    const s = position({ b7: 'wc' });
    const next = applyMove(s, findMove(s, S('b7'), S('a8'))!);
    expect(at(next.board, 'a8')?.kinged).toBe(true);
  });

  it('crowns Black on rank 1', () => {
    const s = position({ b2: 'bc' }, { turn: 'b' });
    const next = applyMove(s, findMove(s, S('b2'), S('a1'))!);
    expect(at(next.board, 'a1')?.kinged).toBe(true);
  });

  it('ends the turn when a hop crowns, even if more hops exist', () => {
    // White hops c6xd7 landing on e8 and is crowned; the chain must stop.
    const s = position({ c6: 'wc', d7: 'bc', d5: 'bc' });
    const next = applyMove(s, findMove(s, S('c6'), S('e8'))!);
    expect(at(next.board, 'e8')?.kinged).toBe(true);
    expect(next.chain).toBeNull();
    expect(next.turn).toBe('b');
  });

  it('does not re-crown an already crowned checker', () => {
    const s = position({ b7: 'wC' });
    const move = findMove(s, S('b7'), S('a8'))!;
    expect(move.promotes).toBe(false);
  });
});

describe('win conditions', () => {
  it('ends the game when a chess piece takes the King', () => {
    const s = position({ d1: 'wQ', d8: 'bK', a7: 'bc' });
    const next = applyMove(s, findMove(s, S('d1'), S('d8'))!);
    expect(next.status).toBe('over');
    expect(next.winner).toBe('w');
    expect(next.winReason).toBe('king-capture');
  });

  it('ends the game when a checker hops the King', () => {
    const s = position({ d4: 'wc', e5: 'bK', a7: 'bc' });
    const next = applyMove(s, findMove(s, S('d4'), S('f6'))!);
    expect(next.status).toBe('over');
    expect(next.winner).toBe('w');
    expect(next.winReason).toBe('king-capture');
  });

  it('produces no further legal moves once over', () => {
    const s = position({ d1: 'wQ', d8: 'bK' });
    const next = applyMove(s, findMove(s, S('d1'), S('d8'))!);
    expect(legalMoves(next)).toEqual([]);
  });

  it('leaves no legal move for a side whose only checker is walled in', () => {
    // An uncrowned White checker on the top rank has both forward diagonals
    // off the board, so it can never move again.
    const s = position({ a8: 'wc', c2: 'bK' }, { turn: 'w' });
    expect(legalMoves(s)).toEqual([]);
  });

  it('awards the win when the side to move is stuck', () => {
    const s = position({ a8: 'wc', c2: 'bK' }, { turn: 'b' });
    const next = applyMove(s, findMove(s, S('c2'), S('b2'))!);
    expect(next.status).toBe('over');
    expect(next.winner).toBe('b');
    expect(next.winReason).toBe('no-moves');
  });

  it('calls a stuck position a draw when the rule says so', () => {
    const s = position(
      { a8: 'wc', c2: 'bK' },
      { turn: 'b', rules: { ...DEFAULT_RULES, lossOnNoMoves: false } },
    );
    const next = applyMove(s, findMove(s, S('c2'), S('b2'))!);
    expect(next.status).toBe('over');
    expect(next.winner).toBeNull();
  });

  it('can be conceded', () => {
    const s = position({ e1: 'wK', e8: 'bK' });
    const next = resign(s, 'w');
    expect(next.status).toBe('over');
    expect(next.winner).toBe('b');
    expect(next.winReason).toBe('resign');
  });
});

describe('immutability and history', () => {
  it('never mutates the state it was handed', () => {
    const s = initialState();
    const before = s.board.slice();
    applyMove(s, legalMoves(s)[0]!);
    expect(s.board).toEqual(before);
    expect(s.history.length).toBe(0);
    expect(s.turn).toBe('w');
  });

  it('records notation and the captured kind', () => {
    const s = position({ d1: 'wQ', d7: 'bc' });
    const next = applyMove(s, findMove(s, S('d1'), S('d7'))!);
    const last = next.history.at(-1)!;
    expect(last.capturedKind).toBe('c');
    expect(last.notation).toBe('Qd1xd7');
  });

  it('alternates turns on a quiet move', () => {
    let s: GameState = initialState();
    const colors: Color[] = [];
    for (let i = 0; i < 4; i++) {
      colors.push(s.turn);
      s = applyMove(s, legalMoves(s).find((m) => !m.isJump)!);
    }
    expect(colors).toEqual(['w', 'b', 'w', 'b']);
    expect(other('w')).toBe('b');
  });
});
