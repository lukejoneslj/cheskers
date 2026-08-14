import { describe, expect, it } from 'vitest';

import { AUGMENTS, augment, draft } from './augments';
import { applyMove, findMove, initialState, legalMovesFrom, movesForPiece } from './rules';
import {
  type AugmentId,
  type Board,
  type Color,
  type GameState,
  type Kind,
  type Piece,
  type Rules,
  DEFAULT_RULES,
  sq,
  squareName,
} from './types';

const S = (name: string) => sq(8 - Number(name[1]), 'abcdefgh'.indexOf(name[0]!));
const at = (b: Board, name: string) => b[S(name)] ?? null;
const targets = (moves: { to: number }[]) => moves.map((m) => squareName(m.to)).sort();

function rules(w: AugmentId[] = [], b: AugmentId[] = []): Rules {
  return { ...DEFAULT_RULES, augments: { w, b } };
}

/** Sparse position builder, matching rules.test.ts. */
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

describe('catalogue', () => {
  it('has a unique, resolvable entry per id', () => {
    const ids = AUGMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(augment(id).id).toBe(id);
  });

  it('never deals an augment the player already holds', () => {
    const held = AUGMENTS.slice(0, 9).map((a) => a.id);
    for (let i = 0; i < 40; i++) {
      const dealt = draft(held, 3, 4);
      for (const a of dealt) expect(held).not.toContain(a.id);
      // Also never deals the same card twice in one draft.
      expect(new Set(dealt.map((d) => d.id)).size).toBe(dealt.length);
    }
  });

  it('deals as many as it can when the pool runs short', () => {
    const held = AUGMENTS.slice(0, AUGMENTS.length - 2).map((a) => a.id);
    expect(draft(held, 3, 1)).toHaveLength(2);
    expect(draft(AUGMENTS.map((a) => a.id), 3, 1)).toHaveLength(0);
  });
});

describe('movement augments', () => {
  it('backpedal lets an uncrowned man retreat', () => {
    const s = position({ d4: 'wc' });
    expect(targets(legalMovesFrom(s, S('d4')))).toEqual(['c5', 'e5']);

    const aug = position({ d4: 'wc' }, { rules: rules(['backpedal']) });
    expect(targets(legalMovesFrom(aug, S('d4')))).toEqual(['c3', 'c5', 'e3', 'e5']);
  });

  it('flank adds sideways steps and hops', () => {
    const s = position({ d4: 'wc', e4: 'bc' }, { rules: rules(['flank']) });
    // Sideways hop over e4 lands on f4; c4 is the plain sideways step.
    expect(targets(legalMovesFrom(s, S('d4')))).toContain('f4');
    expect(targets(legalMovesFrom(s, S('d4')))).toContain('c4');
  });

  it('early_crown promotes a rank sooner', () => {
    // White advances toward rank 8; normally only rank 8 crowns.
    const plain = position({ d6: 'wc' });
    expect(findMove(plain, S('d6'), S('e7'))?.promotes).toBe(false);

    const early = position({ d6: 'wc' }, { rules: rules(['early_crown']) });
    const move = findMove(early, S('d6'), S('e7'))!;
    expect(move.promotes).toBe(true);
    expect(at(applyMove(early, move).board, 'e7')?.kinged).toBe(true);
  });

  it('siege_rook adds a one-square diagonal step', () => {
    const s = position({ a1: 'wR' }, { rules: rules(['siege_rook']) });
    expect(targets(legalMovesFrom(s, S('a1')))).toContain('b2');
  });

  it('outrider_knight adds a one-square step in any direction', () => {
    const s = position({ d4: 'wN' }, { rules: rules(['outrider_knight']) });
    const to = targets(legalMovesFrom(s, S('d4')));
    expect(to).toContain('d5'); // orthogonal step, not a knight move
    expect(to).toContain('e5'); // diagonal step
    expect(to).toContain('e6'); // still moves as a knight
  });

  it('blink_king leaps two squares over an occupied one', () => {
    const s = position({ d4: 'wK', d5: 'wc' }, { rules: rules(['blink_king']) });
    expect(targets(legalMovesFrom(s, S('d4')))).toContain('d6');
  });

  it('amazon_queen adds knight moves', () => {
    const s = position({ d4: 'wQ' }, { rules: rules(['amazon_queen']) });
    expect(targets(legalMovesFrom(s, S('d4')))).toContain('e6');
  });

  it('zealot_bishop hops an adjacent enemy and can chain', () => {
    const s = position(
      { b2: 'wB', c3: 'bc', e5: 'bc' },
      { rules: rules(['zealot_bishop']) },
    );
    const hop = findMove(s, S('b2'), S('d4'))!;
    expect(hop.isJump).toBe(true);
    expect(hop.captured).toBe(S('c3'));

    // Landing on d4 leaves e5 hoppable, so the turn stays with the bishop.
    const after = applyMove(s, hop);
    expect(after.chain).toBe(S('d4'));
    expect(after.turn).toBe('w');
  });

  it('flying_kings slide far and capture from range', () => {
    const s = position(
      { b2: 'wC', f6: 'bc' },
      { rules: rules(['flying_kings']) },
    );
    const to = targets(legalMovesFrom(s, S('b2')));
    expect(to).toContain('e5'); // long quiet slide
    expect(to).toContain('g7'); // landing beyond the victim
    expect(to).toContain('h8'); // and further beyond
    expect(findMove(s, S('b2'), S('h8'))?.captured).toBe(S('f6'));
  });

  it('flying_kings cannot leap two stacked blockers', () => {
    const s = position(
      { b2: 'wC', d4: 'bc', e5: 'bc' },
      { rules: rules(['flying_kings']) },
    );
    // d4 is hoppable only if the square beyond is clear; e5 blocks it.
    expect(targets(legalMovesFrom(s, S('b2')))).not.toContain('f6');
  });
});

describe('consequence augments', () => {
  it('royal_guard destroys the attacker and breaks the shield', () => {
    const s = position(
      { d1: 'wQ', a1: 'wK', d8: 'bK' },
      { rules: rules([], ['royal_guard']) },
    );
    // The shield is applied at initialState, so set it up the same way here.
    const board = s.board.slice() as (Piece | null)[];
    const king = board[S('d8')]!;
    board[S('d8')] = { ...king, shield: true };
    const guarded = { ...s, board };

    const after = applyMove(guarded, findMove(guarded, S('d1'), S('d8'))!);
    expect(after.status).toBe('playing');       // the king survives
    expect(at(after.board, 'd1')).toBeNull();   // the attacker does not
    expect(at(after.board, 'd8')?.kind).toBe('K');
    expect(at(after.board, 'd8')?.shield).toBe(false);

    // Second attempt now lands.
    const again = position({ d2: 'wQ', a1: 'wK', d8: 'bK' });
    expect(applyMove(again, findMove(again, S('d2'), S('d8'))!).status).toBe('over');
  });

  it('royal_guard shields the king from the opening position', () => {
    const s = initialState(rules(['royal_guard']));
    const king = s.board.find((p) => p?.kind === 'K' && p.color === 'w');
    expect(king?.shield).toBe(true);
    const enemyKing = s.board.find((p) => p?.kind === 'K' && p.color === 'b');
    expect(enemyKing?.shield).toBeUndefined();
  });

  it('undying brings the first lost checker back once', () => {
    const start = initialState(rules([], ['undying']));
    expect(start.revives?.b).toBe(1);

    // Clear a home square so the revive has somewhere to land, then take a
    // black checker with a white one.
    const board = start.board.slice() as (Piece | null)[];
    board[S('a7')] = null;                    // free home square for the revive
    board[S('d4')] = { kind: 'c', color: 'w', kinged: false, id: 900 };
    board[S('e5')] = { kind: 'c', color: 'b', kinged: false, id: 901 };
    const s: GameState = { ...start, board, nextId: 902 };

    const after = applyMove(s, findMove(s, S('d4'), S('f6'))!);
    expect(at(after.board, 'a7')?.color).toBe('b');
    expect(after.revives?.b).toBe(0);
  });

  it('undying does not fire a second time', () => {
    const start = initialState(rules([], ['undying']));
    const board = start.board.slice() as (Piece | null)[];
    board[S('a7')] = null;
    board[S('d4')] = { kind: 'c', color: 'w', kinged: false, id: 900 };
    board[S('e5')] = { kind: 'c', color: 'b', kinged: false, id: 901 };
    const s: GameState = { ...start, board, nextId: 902, revives: { w: 0, b: 0 } };

    const after = applyMove(s, findMove(s, S('d4'), S('f6'))!);
    expect(at(after.board, 'a7')).toBeNull();
  });

  it('bloodcrown crowns a capturing man anywhere on the board', () => {
    const s = position({ d4: 'wc', e5: 'bc' }, { rules: rules(['bloodcrown']) });
    const after = applyMove(s, findMove(s, S('d4'), S('f6'))!);
    expect(at(after.board, 'f6')?.kinged).toBe(true);
  });

  it('relentless keeps a chain alive through a crowning', () => {
    // b6 hops c7 and lands crowned on d8; once crowned it can hop backwards
    // over e7, so there is a genuine chain waiting to continue.
    const layout = { b6: 'wc', c7: 'bc', e7: 'bc' };

    const plain = position(layout);
    const crowning = findMove(plain, S('b6'), S('d8'))!;
    expect(crowning.promotes).toBe(true);
    // Without relentless, crowning ends the turn even though e7 is hoppable.
    expect(applyMove(plain, crowning).turn).toBe('b');

    const aug = position(layout, { rules: rules(['relentless']) });
    const after = applyMove(aug, findMove(aug, S('b6'), S('d8'))!);
    expect(after.turn).toBe('w');
    expect(after.chain).toBe(S('d8'));
  });
});

describe('augments are per side', () => {
  it('does not grant one side the other side augments', () => {
    const s = position({ d4: 'wc', d5: 'bc' }, { rules: rules(['backpedal']) });
    // White retreats...
    expect(targets(movesForPiece(s.board, S('d4'), s.rules))).toContain('c3');
    // ...black does not.
    expect(targets(movesForPiece(s.board, S('d5'), s.rules))).not.toContain('c6');
  });
});
