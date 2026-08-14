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

describe('per-piece augments', () => {
  it('heartstone gives every checker a spare life', () => {
    const s = initialState(rules(['heartstone']));
    const whiteCheckers = s.board.filter((p) => p?.color === 'w' && p.kind === 'c');
    expect(whiteCheckers).toHaveLength(8);
    expect(whiteCheckers.every((p) => p!.lives === 1)).toBe(true);
    // The other side gets nothing.
    expect(s.board.filter((p) => p?.color === 'b' && p.kind === 'c')
      .every((p) => p!.lives === undefined)).toBe(true);
  });

  it('a spare life bounces the attack and keeps both pieces in place', () => {
    const s = position({ d4: 'wc', e5: 'bc', a1: 'wK', h8: 'bK' }, {});
    const board = s.board.slice() as (Piece | null)[];
    board[S('e5')] = { ...board[S('e5')]!, lives: 1 };
    const guarded: GameState = { ...s, board };

    const after = applyMove(guarded, findMove(guarded, S('d4'), S('f6'))!);
    expect(at(after.board, 'd4')?.kind).toBe('c');  // attacker never moved
    expect(at(after.board, 'f6')).toBeNull();
    expect(at(after.board, 'e5')?.lives).toBe(0);   // victim spent the life
    expect(after.turn).toBe('b');

    // With the life spent, the same hop now lands.
    const spent = applyMove(after, findMove({ ...after, turn: 'w' }, S('d4'), S('f6'))!);
    expect(at(spent.board, 'e5')).toBeNull();
  });

  it('ascension walks a capturing piece up the ladder', () => {
    const s = position({ d4: 'wc', e5: 'bc', a1: 'wK', h8: 'bK' }, {
      rules: rules(['ascension']),
    });
    const after = applyMove(s, findMove(s, S('d4'), S('f6'))!);
    expect(at(after.board, 'f6')?.kind).toBe('N');

    // A knight that takes becomes a bishop, and so on up to a queen.
    const ladder = position({ d4: 'wR', e5: 'bc', a1: 'wK', h8: 'bK' }, {
      rules: rules(['ascension']),
    });
    const promoted = applyMove(ladder, findMove(ladder, S('d4'), S('d5'))!);
    void promoted;
    const rookTakes = position({ d4: 'wR', d5: 'bc', a1: 'wK', h8: 'bK' }, {
      rules: rules(['ascension']),
    });
    expect(at(applyMove(rookTakes, findMove(rookTakes, S('d4'), S('d5'))!).board, 'd5')?.kind)
      .toBe('Q');
  });

  it('ascension stops at queen', () => {
    const s = position({ d4: 'wQ', d5: 'bc', a1: 'wK', h8: 'bK' }, {
      rules: rules(['ascension']),
    });
    expect(at(applyMove(s, findMove(s, S('d4'), S('d5'))!).board, 'd5')?.kind).toBe('Q');
  });

  it('veterancy pays a life at two kills and a free step at three', () => {
    let s = position(
      { d4: 'wR', d5: 'bc', d6: 'bc', d7: 'bc', a1: 'wK', h8: 'bK' },
      { rules: rules(['veterancy']) },
    );
    // First kill: one mark, nothing yet.
    s = applyMove(s, findMove(s, S('d4'), S('d5'))!);
    expect(at(s.board, 'd5')?.marks).toBe(1);
    expect(at(s.board, 'd5')?.lives).toBeUndefined();

    // Second kill: the spare life lands.
    s = { ...s, turn: 'w' };
    s = applyMove(s, findMove(s, S('d5'), S('d6'))!);
    expect(at(s.board, 'd6')?.marks).toBe(2);
    expect(at(s.board, 'd6')?.lives).toBe(1);

    // Third kill: now it also steps any direction, which a rook cannot do.
    s = { ...s, turn: 'w' };
    s = applyMove(s, findMove(s, S('d6'), S('d7'))!);
    expect(at(s.board, 'd7')?.marks).toBe(3);
    expect(targets(legalMovesFrom({ ...s, turn: 'w' }, S('d7')))).toContain('c6');
  });

  it('veterancy marks are counted even without the augment', () => {
    // The counter is free; only the payouts are gated, so turning the augment
    // on mid-run would not retroactively reward old kills.
    const s = position({ d4: 'wR', d5: 'bc', a1: 'wK', h8: 'bK' });
    const after = applyMove(s, findMove(s, S('d4'), S('d5'))!);
    expect(at(after.board, 'd5')?.marks).toBe(1);
    expect(at(after.board, 'd5')?.lives).toBeUndefined();
  });

  it('powder keg arms one checker on the d-file', () => {
    const s = initialState(rules(['powder_keg']));
    const armed = s.board.filter((p) => p?.bomb !== undefined);
    expect(armed).toHaveLength(1);
    expect(armed[0]!.color).toBe('w');
    expect(armed[0]!.kind).toBe('c');
    expect(armed[0]!.bomb).toBe(6);
    expect(s.board[S('d2')]?.bomb).toBe(6);
  });

  it('taking an armed piece levels the neighbourhood', () => {
    // The hop d4xe5 lands on f6, which puts the attacker inside the blast.
    const s = position(
      { d4: 'wc', e5: 'bc', d6: 'bN', f4: 'bR', a1: 'wK', h8: 'bK' },
      {},
    );
    const board = s.board.slice() as (Piece | null)[];
    board[S('e5')] = { ...board[S('e5')]!, bomb: 3 };
    const armed: GameState = { ...s, board };

    const after = applyMove(armed, findMove(armed, S('d4'), S('f6'))!);
    expect(at(after.board, 'e5')).toBeNull();  // the keg
    expect(at(after.board, 'd6')).toBeNull();  // neighbour
    expect(at(after.board, 'f4')).toBeNull();  // neighbour
    expect(at(after.board, 'f6')).toBeNull();  // the attacker that landed beside it
    // Far corners are untouched.
    expect(at(after.board, 'a1')?.kind).toBe('K');
    expect(at(after.board, 'h8')?.kind).toBe('K');
  });

  it('a fuse burns down on its owner turns and then goes off', () => {
    const s = position({ d4: 'wc', e5: 'wN', a1: 'wK', h8: 'bK', a8: 'bc' }, {});
    const board = s.board.slice() as (Piece | null)[];
    board[S('d4')] = { ...board[S('d4')]!, bomb: 2 };
    let game: GameState = { ...s, board, turn: 'b' };

    // Black moves; white's fuse ticks as white's turn opens.
    game = applyMove(game, findMove(game, S('a8'), S('b7'))!);
    expect(at(game.board, 'd4')?.bomb).toBe(1);

    // White moves something else, black replies, and the fuse hits zero.
    game = applyMove(game, findMove(game, S('a1'), S('b1'))!);
    game = applyMove(game, findMove(game, S('b7'), S('c6'))!);
    expect(at(game.board, 'd4')).toBeNull();
    expect(at(game.board, 'e5')).toBeNull(); // its own knight caught the blast
  });

  it('a blast that takes the last king ends the game', () => {
    const s = position({ d4: 'wc', e5: 'bK', a1: 'wK' }, {});
    const board = s.board.slice() as (Piece | null)[];
    board[S('d4')] = { ...board[S('d4')]!, bomb: 1 };
    const game: GameState = { ...s, board, turn: 'b' };

    // The black king steps to d5 — still inside the blast radius — and the
    // fuse runs out the moment white's turn opens.
    const after = applyMove(game, findMove(game, S('e5'), S('d5'))!);
    expect(at(after.board, 'd5')).toBeNull();
    expect(after.status).toBe('over');
    expect(after.winner).toBe('w');
  });
});

describe('missionary bishop', () => {
  it('adds an orthogonal step without losing the diagonals', () => {
    const plain = position({ d4: 'wB' });
    expect(targets(legalMovesFrom(plain, S('d4')))).not.toContain('d5');

    const s = position({ d4: 'wB' }, { rules: rules(['missionary_bishop']) });
    const reach = targets(legalMovesFrom(s, S('d4')));
    for (const square of ['c4', 'd3', 'd5', 'e4']) expect(reach).toContain(square);
    expect(reach).toContain('h8'); // still a bishop
  });
});

describe('raider knight', () => {
  const layout = { d4: 'wN', d5: 'bc', d7: 'bc', a1: 'wK', h8: 'bK' };

  it('lets a knight hop an adjacent enemy', () => {
    const plain = position(layout);
    // A knight cannot touch the square directly in front of it.
    expect(targets(legalMovesFrom(plain, S('d4')))).not.toContain('d6');

    const s = position(layout, { rules: rules(['raider_knight']) });
    expect(targets(legalMovesFrom(s, S('d4')))).toContain('d6');
  });

  it('chains its hops like a checker', () => {
    const s = position(layout, { rules: rules(['raider_knight']) });
    const after = applyMove(s, findMove(s, S('d4'), S('d6'))!);
    expect(at(after.board, 'd5')).toBeNull();
    // d7 is still hoppable from d6, so the turn stays with the knight.
    expect(after.turn).toBe('w');
    expect(after.chain).toBe(S('d6'));
  });
});

describe('aegis', () => {
  it('shields both rooks at the start', () => {
    const s = initialState(rules(['aegis']));
    const rooks = s.board.filter((p) => p?.color === 'w' && p.kind === 'R');
    expect(rooks).toHaveLength(2);
    expect(rooks.every((p) => p!.shield === true)).toBe(true);
    expect(s.board.filter((p) => p?.color === 'b' && p.kind === 'R')
      .every((p) => p!.shield === undefined)).toBe(true);
  });

  it('destroys the first attacker and then breaks', () => {
    const s = position({ d4: 'wR', d5: 'bR', a1: 'wK', h8: 'bK' });
    const board = s.board.slice() as (Piece | null)[];
    board[S('d5')] = { ...board[S('d5')]!, shield: true };
    let game: GameState = { ...s, board };

    game = applyMove(game, findMove(game, S('d4'), S('d5'))!);
    expect(at(game.board, 'd4')).toBeNull();          // attacker destroyed
    expect(at(game.board, 'd5')?.kind).toBe('R');     // defender held the square
    expect(at(game.board, 'd5')?.shield).toBe(false); // and spent the shield
    expect(game.turn).toBe('b');
    // Nothing died, so the log must not claim a capture.
    expect(game.history.at(-1)?.capturedKind).toBeNull();
    expect(game.history.at(-1)?.captured).toBeNull();
  });
});

describe('phalanx', () => {
  // e5 and f5 stand shoulder to shoulder; d4 would like to hop e5 onto f6.
  const layout = { d4: 'wc', e5: 'bc', f5: 'bc', a1: 'wK', h8: 'bK' };

  it('denies a hop against a supported checker', () => {
    expect(targets(legalMovesFrom(position(layout), S('d4')))).toContain('f6');

    const s = position(layout, { rules: rules([], ['phalanx']) });
    expect(targets(legalMovesFrom(s, S('d4')))).not.toContain('f6');
  });

  it('does nothing for a checker standing alone', () => {
    const s = position({ d4: 'wc', e5: 'bc', a1: 'wK', h8: 'bK' }, {
      rules: rules([], ['phalanx']),
    });
    expect(targets(legalMovesFrom(s, S('d4')))).toContain('f6');
  });

  it('only turns aside hops, not ordinary captures', () => {
    const s = position({ b2: 'wB', e5: 'bc', f5: 'bc', a1: 'wK', h8: 'bK' }, {
      rules: rules([], ['phalanx']),
    });
    expect(targets(legalMovesFrom(s, S('b2')))).toContain('e5');
  });
});

describe('reaping', () => {
  it('raises a man on the home rank every third kill', () => {
    let s = position(
      { d4: 'wR', d5: 'bc', d6: 'bc', d7: 'bc', a1: 'wK', h8: 'bK' },
      { rules: rules(['reaping']) },
    );
    const men = (g: GameState) =>
      g.board.filter((p) => p?.color === 'w' && p.kind === 'c').length;

    s = applyMove(s, findMove(s, S('d4'), S('d5'))!);
    expect(men(s)).toBe(0);
    s = applyMove({ ...s, turn: 'w' }, findMove({ ...s, turn: 'w' }, S('d5'), S('d6'))!);
    expect(men(s)).toBe(0);
    s = applyMove({ ...s, turn: 'w' }, findMove({ ...s, turn: 'w' }, S('d6'), S('d7'))!);
    expect(men(s)).toBe(1);
    expect(at(s.board, 'a2')?.kind).toBe('c');
    expect(at(s.board, 'a2')?.color).toBe('w');
  });
});

describe('gorge', () => {
  it('stacks a spare life onto the piece for every kill', () => {
    let s = position(
      { d4: 'wR', d5: 'bc', d6: 'bc', a1: 'wK', h8: 'bK' },
      { rules: rules(['gorge']) },
    );
    s = applyMove(s, findMove(s, S('d4'), S('d5'))!);
    expect(at(s.board, 'd5')?.lives).toBe(1);
    s = applyMove({ ...s, turn: 'w' }, findMove({ ...s, turn: 'w' }, S('d5'), S('d6'))!);
    expect(at(s.board, 'd6')?.lives).toBe(2);
  });
});

describe('ironclad', () => {
  it('gives every chess piece but the king a spare life', () => {
    const s = initialState(rules(['ironclad']));
    const white = s.board.filter((p) => p?.color === 'w');
    for (const piece of white) {
      if (piece!.kind === 'c' || piece!.kind === 'K') {
        expect(piece!.lives).toBeUndefined();
      } else {
        expect(piece!.lives).toBe(1);
      }
    }
    expect(s.board.filter((p) => p?.color === 'b').every((p) => p!.lives === undefined))
      .toBe(true);
  });
});

describe('martyr', () => {
  const layout = { d4: 'wc', e5: 'bc', d6: 'bN', f4: 'bR', a1: 'wK', h8: 'bK' };

  it('levels the neighbourhood when one of its checkers is taken', () => {
    const s = position(layout, { rules: rules([], ['martyr']) });
    const after = applyMove(s, findMove(s, S('d4'), S('f6'))!);
    expect(at(after.board, 'e5')).toBeNull(); // the martyr
    expect(at(after.board, 'd6')).toBeNull(); // its own knight
    expect(at(after.board, 'f4')).toBeNull(); // its own rook
    expect(at(after.board, 'f6')).toBeNull(); // the attacker that landed beside it
    expect(at(after.board, 'a1')?.kind).toBe('K');
    expect(at(after.board, 'h8')?.kind).toBe('K');
  });

  it('does not arm the other side checkers', () => {
    const s = position(layout, { rules: rules(['martyr']) });
    const after = applyMove(s, findMove(s, S('d4'), S('f6'))!);
    expect(at(after.board, 'f6')?.kind).toBe('c'); // ordinary hop, no blast
    expect(at(after.board, 'd6')?.kind).toBe('N');
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
