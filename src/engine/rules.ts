/** Move generation and state transition for Cheskers.
 *
 * Rule summary (as chosen for this build):
 *  - Back rank is standard chess: R N B Q K B N R. Second rank is checkers men.
 *  - Chess pieces move and capture by displacement, exactly as in chess.
 *  - Checkers men step diagonally forward, hop over an adjacent enemy of ANY
 *    kind onto the empty square beyond, and chain further hops in one turn.
 *  - A man reaching the far rank is crowned and may then move backwards. Being
 *    crowned ends the turn even mid-chain, as in standard checkers.
 *  - There is no check or checkmate. Capturing the enemy King wins outright,
 *    so a King must be defended by hand.
 *  - With `forcedJumps` on, if any hop is available the mover must hop.
 */

import {
  type Board,
  type Color,
  type GameState,
  type Kind,
  type Move,
  type MoveRecord,
  type Piece,
  type Rules,
  type Sq,
  type WinReason,
  DEFAULT_RULES,
  col,
  hasAugment,
  onBoard,
  row,
  sq,
  squareName,
} from './types';

const ORTHOGONAL: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];
const DIAGONAL: ReadonlyArray<readonly [number, number]> = [
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];
const OMNI = [...ORTHOGONAL, ...DIAGONAL];
const KNIGHT: ReadonlyArray<readonly [number, number]> = [
  [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2],
];
/** Two squares in any direction, leaping whatever stands between — the
 *  `blink_king` augment. */
const LEAP2: ReadonlyArray<readonly [number, number]> = OMNI.map(
  ([dr, dc]) => [dr * 2, dc * 2] as const,
);
const SIDEWAYS: ReadonlyArray<readonly [number, number]> = [[0, 1], [0, -1]];

/** How many of the owner's turns a `powder_keg` burns for before it goes off.
 *  Long enough to plan around, short enough to force the issue. */
export const FUSE_TURNS = 6;
/** File the armed checker starts on. Fixed rather than random: both clients in
 *  an online game build the opening position independently and must agree. */
const KEG_FILE = 3;
/** Marks at which `veterancy` pays out. */
const VETERAN_LIFE_AT = 2;
const VETERAN_STEP_AT = 3;

/** `ascension` walks a capturing piece up this ladder, one rung per kill. */
const ASCENSION_LADDER: Partial<Record<Kind, Kind>> = {
  c: 'N',
  N: 'B',
  B: 'R',
  R: 'Q',
};

export const at = (board: Board, s: Sq): Piece | null => board[s] ?? null;

const isEnemy = (p: Piece | null, color: Color): p is Piece =>
  p !== null && p.color !== color;

/** True when landing on row `r` crowns a checker of this colour. `early_crown`
 *  moves the line one rank nearer, so it is a range test rather than an
 *  equality test. */
function crowns(color: Color, r: number, rules: Rules): boolean {
  const early = hasAugment(rules, color, 'early_crown');
  return color === 'w' ? r <= (early ? 1 : 0) : r >= (early ? 6 : 7);
}

// ---------------------------------------------------------------------------
// Initial position
// ---------------------------------------------------------------------------

const BACK_RANK: readonly Kind[] = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];

export function initialState(rules: Rules = DEFAULT_RULES): GameState {
  const board: (Piece | null)[] = Array(64).fill(null);
  let id = 0;
  for (let c = 0; c < 8; c++) {
    board[sq(0, c)] = { kind: BACK_RANK[c]!, color: 'b', kinged: false, id: id++ };
    board[sq(1, c)] = { kind: 'c', color: 'b', kinged: false, id: id++ };
    board[sq(6, c)] = { kind: 'c', color: 'w', kinged: false, id: id++ };
    board[sq(7, c)] = { kind: BACK_RANK[c]!, color: 'w', kinged: false, id: id++ };
  }

  // Augments that start the game already in effect rather than triggering
  // off a move.
  for (const color of ['w', 'b'] as Color[]) {
    if (hasAugment(rules, color, 'royal_guard')) {
      const kingSq = board.findIndex((p) => p?.kind === 'K' && p.color === color);
      const king = kingSq >= 0 ? board[kingSq] : null;
      if (king) board[kingSq] = { ...king, shield: true };
    }

    if (hasAugment(rules, color, 'heartstone')) {
      for (let s = 0; s < 64; s++) {
        const piece = board[s];
        if (piece?.color === color && piece.kind === 'c') {
          board[s] = { ...piece, lives: (piece.lives ?? 0) + 1 };
        }
      }
    }

    if (hasAugment(rules, color, 'powder_keg')) {
      const rank = color === 'w' ? 6 : 1;
      const kegSq = sq(rank, KEG_FILE);
      const carrier = board[kegSq];
      if (carrier) board[kegSq] = { ...carrier, bomb: FUSE_TURNS };
    }
  }

  return {
    board,
    turn: 'w',
    chain: null,
    status: 'playing',
    winner: null,
    winReason: null,
    history: [],
    rules,
    nextId: id,
    revives: {
      w: hasAugment(rules, 'w', 'undying') ? 1 : 0,
      b: hasAugment(rules, 'b', 'undying') ? 1 : 0,
    },
  };
}

/** Blow up the piece on `at` and everything on the eight squares around it,
 *  regardless of colour. Mutates `board` in place and returns the squares
 *  cleared, so the renderer can throw the right debris.
 *
 * A chain is deliberately *not* implemented: one keg setting off another
 * would make the blast radius unpredictable in a game where you are supposed
 * to be able to count squares. */
function detonate(board: (Piece | null)[], centre: Sq): Sq[] {
  const cleared: Sq[] = [];
  const r0 = row(centre);
  const c0 = col(centre);
  if (board[centre]) {
    board[centre] = null;
    cleared.push(centre);
  }
  for (const [dr, dc] of OMNI) {
    const r = r0 + dr;
    const c = c0 + dc;
    if (!onBoard(r, c)) continue;
    const s = sq(r, c);
    if (!board[s]) continue;
    board[s] = null;
    cleared.push(s);
  }
  return cleared;
}

/** After a blast, work out whether anyone still has a King. */
function settleAfterBlast(state: GameState, board: (Piece | null)[]): GameState | null {
  const whiteKing = board.some((p) => p?.kind === 'K' && p.color === 'w');
  const blackKing = board.some((p) => p?.kind === 'K' && p.color === 'b');
  if (whiteKing && blackKing) return null;
  const next = { ...state, board };
  if (!whiteKing && !blackKing) return finish(next, null, 'king-capture');
  return finish(next, whiteKing ? 'w' : 'b', 'king-capture');
}

/** Burn one turn off every fuse belonging to the side about to move, and set
 *  off anything that reaches zero. */
function tickBombs(state: GameState): GameState {
  const armed: Sq[] = [];
  state.board.forEach((piece, s) => {
    if (piece?.color === state.turn && piece.bomb !== undefined) armed.push(s);
  });
  if (armed.length === 0) return state;

  const board = state.board.slice() as (Piece | null)[];
  const blown: Sq[] = [];
  for (const s of armed) {
    const piece = board[s];
    if (!piece || piece.bomb === undefined) continue;
    const fuse = piece.bomb - 1;
    if (fuse > 0) {
      board[s] = { ...piece, bomb: fuse };
    } else {
      blown.push(s);
    }
  }
  // Every fuse is read before any of them goes off, so two kegs expiring on
  // the same turn cannot delete each other mid-loop.
  for (const s of blown) detonate(board, s);
  if (blown.length === 0) return { ...state, board };

  return settleAfterBlast(state, board) ?? { ...state, board };
}

/** Where an `undying` checker comes back: its own checker rank first, then
 *  its back rank. Returns null when the side has no room left to respawn. */
function respawnSquare(board: Board, color: Color): Sq | null {
  const ranks = color === 'w' ? [6, 7] : [1, 0];
  for (const r of ranks) {
    for (let c = 0; c < 8; c++) {
      if (!at(board, sq(r, c))) return sq(r, c);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Move generation
// ---------------------------------------------------------------------------

function slide(
  board: Board,
  from: Sq,
  color: Color,
  dirs: ReadonlyArray<readonly [number, number]>,
  out: Move[],
): void {
  for (const [dr, dc] of dirs) {
    let r = row(from) + dr;
    let c = col(from) + dc;
    while (onBoard(r, c)) {
      const to = sq(r, c);
      const cell = at(board, to);
      if (!cell) {
        out.push({ from, to, captured: null, isJump: false, promotes: false });
      } else {
        if (isEnemy(cell, color)) {
          out.push({ from, to, captured: to, isJump: false, promotes: false });
        }
        break;
      }
      r += dr;
      c += dc;
    }
  }
}

function step(
  board: Board,
  from: Sq,
  color: Color,
  offsets: ReadonlyArray<readonly [number, number]>,
  out: Move[],
): void {
  for (const [dr, dc] of offsets) {
    const r = row(from) + dr;
    const c = col(from) + dc;
    if (!onBoard(r, c)) continue;
    const to = sq(r, c);
    const cell = at(board, to);
    if (!cell) {
      out.push({ from, to, captured: null, isJump: false, promotes: false });
    } else if (isEnemy(cell, color)) {
      out.push({ from, to, captured: to, isJump: false, promotes: false });
    }
  }
}

/** Checker-style movement along `dirs`: an empty neighbour is a step, an
 *  adjacent enemy with space beyond is a hop. `stepsToo` is false for pieces
 *  that only *gain* the hop (an augmented bishop still slides as a bishop). */
function hopMoves(
  board: Board,
  from: Sq,
  piece: Piece,
  dirs: ReadonlyArray<readonly [number, number]>,
  out: Move[],
  rules: Rules,
  stepsToo: boolean,
): void {
  const canCrown = piece.kind === 'c' && !piece.kinged;

  for (const [dr, dc] of dirs) {
    const r = row(from) + dr;
    const c = col(from) + dc;
    if (!onBoard(r, c)) continue;
    const over = sq(r, c);
    const neighbour = at(board, over);

    if (!neighbour) {
      if (stepsToo) {
        out.push({
          from,
          to: over,
          captured: null,
          isJump: false,
          promotes: canCrown && crowns(piece.color, r, rules),
        });
      }
      continue;
    }

    // Occupied: the only option in this direction is hopping it.
    if (!isEnemy(neighbour, piece.color)) continue;
    const jr = row(from) + dr * 2;
    const jc = col(from) + dc * 2;
    if (!onBoard(jr, jc)) continue;
    const landing = sq(jr, jc);
    if (at(board, landing)) continue;
    out.push({
      from,
      to: landing,
      captured: over,
      isJump: true,
      promotes: canCrown && crowns(piece.color, jr, rules),
    });
  }
}

/** International-draughts "flying king": a crowned checker slides any distance
 *  along a diagonal, and may capture a lone enemy from range, landing on any
 *  empty square beyond it. */
function flyingKingMoves(board: Board, from: Sq, piece: Piece, out: Move[]): void {
  for (const [dr, dc] of DIAGONAL) {
    let r = row(from) + dr;
    let c = col(from) + dc;

    // Glide over the empty run.
    while (onBoard(r, c) && !at(board, sq(r, c))) {
      out.push({ from, to: sq(r, c), captured: null, isJump: false, promotes: false });
      r += dr;
      c += dc;
    }
    if (!onBoard(r, c)) continue;

    const blocker = at(board, sq(r, c));
    if (!isEnemy(blocker, piece.color)) continue;
    const victim = sq(r, c);

    // Any empty square beyond a lone enemy is a legal landing.
    let lr = r + dr;
    let lc = c + dc;
    while (onBoard(lr, lc) && !at(board, sq(lr, lc))) {
      out.push({ from, to: sq(lr, lc), captured: victim, isJump: true, promotes: false });
      lr += dr;
      lc += dc;
    }
  }
}

function checkerMoves(board: Board, from: Sq, piece: Piece, out: Move[], rules: Rules): void {
  if (piece.kinged && hasAugment(rules, piece.color, 'flying_kings')) {
    flyingKingMoves(board, from, piece, out);
    return;
  }

  const forward = piece.color === 'w' ? -1 : 1;
  // A crowned man moves both ways; `backpedal` grants that to plain men too.
  const wideOpen = piece.kinged || hasAugment(rules, piece.color, 'backpedal');
  const dirs = [
    ...(wideOpen
      ? DIAGONAL
      : ([[forward, 1], [forward, -1]] as ReadonlyArray<readonly [number, number]>)),
    ...(hasAugment(rules, piece.color, 'flank') ? SIDEWAYS : []),
  ];
  hopMoves(board, from, piece, dirs, out, rules, true);
}

/** Every pseudo-legal move for the piece on `from`, ignoring compulsory
 *  capture and whose turn it is. */
export function movesForPiece(
  board: Board,
  from: Sq,
  rules: Rules = DEFAULT_RULES,
): Move[] {
  const piece = at(board, from);
  if (!piece) return [];
  const out: Move[] = [];
  const own = piece.color;
  switch (piece.kind) {
    case 'R':
      slide(board, from, own, ORTHOGONAL, out);
      if (hasAugment(rules, own, 'siege_rook')) step(board, from, own, DIAGONAL, out);
      break;
    case 'B':
      slide(board, from, own, DIAGONAL, out);
      if (hasAugment(rules, own, 'zealot_bishop')) {
        hopMoves(board, from, piece, DIAGONAL, out, rules, false);
      }
      break;
    case 'Q':
      slide(board, from, own, OMNI, out);
      if (hasAugment(rules, own, 'amazon_queen')) step(board, from, own, KNIGHT, out);
      break;
    case 'N':
      step(board, from, own, KNIGHT, out);
      if (hasAugment(rules, own, 'outrider_knight')) step(board, from, own, OMNI, out);
      break;
    case 'K':
      step(board, from, own, OMNI, out);
      if (hasAugment(rules, own, 'blink_king')) step(board, from, own, LEAP2, out);
      break;
    case 'c':
      checkerMoves(board, from, piece, out, rules);
      break;
  }

  // A decorated veteran learns to step in any direction, on top of whatever
  // its kind already does.
  if (
    (piece.marks ?? 0) >= VETERAN_STEP_AT &&
    hasAugment(rules, own, 'veterancy') &&
    piece.kind !== 'K'
  ) {
    step(board, from, own, OMNI, out);
  }
  return out;
}

/** Every legal move for the side to move, with compulsory capture and any
 *  in-progress jump chain applied. */
export function legalMoves(state: GameState): Move[] {
  if (state.status === 'over') return [];

  // Mid-chain: only the jumping piece may act, and only by jumping again.
  if (state.chain !== null) {
    return movesForPiece(state.board, state.chain, state.rules).filter((m) => m.isJump);
  }

  const all: Move[] = [];
  for (let s = 0; s < 64; s++) {
    if (at(state.board, s)?.color === state.turn) {
      all.push(...movesForPiece(state.board, s, state.rules));
    }
  }

  if (state.rules.forcedJumps) {
    const jumps = all.filter((m) => m.isJump);
    if (jumps.length > 0) return jumps;
  }
  return all;
}

/** Legal moves originating from one square — what the UI highlights on select. */
export function legalMovesFrom(state: GameState, from: Sq): Move[] {
  return legalMoves(state).filter((m) => m.from === from);
}

export function findMove(state: GameState, from: Sq, to: Sq): Move | null {
  return legalMoves(state).find((m) => m.from === from && m.to === to) ?? null;
}

// ---------------------------------------------------------------------------
// Applying a move
// ---------------------------------------------------------------------------

const label = (piece: Piece): string =>
  piece.kind === 'c' ? (piece.kinged ? 'C' : 'c') : piece.kind;

function notate(
  piece: Piece,
  move: Move,
  capturedKind: Kind | null,
  promotes: boolean,
): string {
  const link = move.isJump ? 'x' : capturedKind ? 'x' : '–';
  return (
    `${label(piece)}${squareName(move.from)}${link}${squareName(move.to)}` +
    (promotes ? '=C' : '')
  );
}

/** Apply a legal move, returning a brand new state. The input is never mutated,
 *  which keeps undo, network replay and animation snapshots trivial. */
export function applyMove(state: GameState, move: Move): GameState {
  const board = state.board.slice() as (Piece | null)[];
  const mover = at(board, move.from);
  if (!mover) throw new Error(`no piece on square ${move.from}`);

  const { rules } = state;
  const capturedPiece = move.captured !== null ? at(board, move.captured) : null;

  // `royal_guard`: a shielded King turns the first attempt on it aside, and
  // the attacker is destroyed rather than taking the square. The shield goes
  // with it, so the second attempt lands.
  if (capturedPiece?.kind === 'K' && capturedPiece.shield && move.captured !== null) {
    board[move.captured] = { ...capturedPiece, shield: false };
    board[move.from] = null;
    const guarded: MoveRecord = {
      ...move,
      kind: mover.kind,
      color: mover.color,
      capturedKind: null,
      chained: state.chain !== null,
      notation: `${label(mover)}${squareName(move.from)}✗${squareName(move.to)}`,
    };
    return startTurn({
      ...state,
      board,
      history: [...state.history, guarded],
      chain: null,
      turn: other(state.turn),
    });
  }

  // A spare life turns the attack aside: the victim survives where it stands,
  // spends the life, and the attacker simply does not get the square.
  if (capturedPiece && (capturedPiece.lives ?? 0) > 0 && move.captured !== null) {
    board[move.captured] = { ...capturedPiece, lives: (capturedPiece.lives ?? 0) - 1 };
    const bounced: MoveRecord = {
      ...move,
      captured: null,
      promotes: false,
      kind: mover.kind,
      color: mover.color,
      capturedKind: null,
      chained: state.chain !== null,
      notation: `${label(mover)}${squareName(move.from)}✗${squareName(move.to)}`,
    };
    return startTurn({
      ...state,
      board,
      history: [...state.history, bounced],
      chain: null,
      turn: other(state.turn),
    });
  }

  if (move.captured !== null) board[move.captured] = null;
  board[move.from] = null;

  // `bloodcrown` crowns a man the moment it takes something, wherever it is.
  const bloodcrown =
    move.captured !== null && hasAugment(rules, mover.color, 'bloodcrown');
  const promotes =
    mover.kind === 'c' && !mover.kinged && (move.promotes || bloodcrown);
  let moved: Piece = promotes ? { ...mover, kinged: true } : mover;

  if (move.captured !== null) {
    const marks = (moved.marks ?? 0) + 1;
    moved = { ...moved, marks };

    // `veterancy`: the second kill earns a spare life, the third earns the
    // extra step (granted in movesForPiece, off the same counter).
    if (hasAugment(rules, mover.color, 'veterancy') && marks === VETERAN_LIFE_AT) {
      moved = { ...moved, lives: (moved.lives ?? 0) + 1 };
    }

    // `ascension`: every kill walks the piece one rung up the ladder.
    if (hasAugment(rules, mover.color, 'ascension')) {
      const next = ASCENSION_LADDER[moved.kind];
      if (next) moved = { ...moved, kind: next, kinged: false };
    }
  }

  board[move.to] = moved;

  // Taking an armed piece sets it off where it stood -- which can easily take
  // the attacker with it.
  if (capturedPiece?.bomb !== undefined && move.captured !== null) {
    detonate(board, move.captured);
    const ended = settleAfterBlast(state, board);
    if (ended) {
      return {
        ...ended,
        history: [
          ...state.history,
          {
            ...move,
            promotes,
            kind: mover.kind,
            color: mover.color,
            capturedKind: capturedPiece.kind,
            chained: state.chain !== null,
            notation: `${label(mover)}${squareName(move.from)}✸${squareName(move.to)}`,
          },
        ],
      };
    }
    return startTurn({
      ...state,
      board,
      history: [
        ...state.history,
        {
          ...move,
          promotes,
          kind: mover.kind,
          color: mover.color,
          capturedKind: capturedPiece.kind,
          chained: state.chain !== null,
          notation: `${label(mover)}${squareName(move.from)}✸${squareName(move.to)}`,
        },
      ],
      chain: null,
      turn: other(state.turn),
    });
  }

  // `undying`: the first man a side loses climbs back out onto its home rank.
  // It comes back with a fresh id so the renderer treats it as a new arrival
  // rather than teleporting the corpse.
  let nextId = state.nextId;
  const revives = { ...(state.revives ?? {}) };
  if (
    capturedPiece &&
    capturedPiece.kind === 'c' &&
    hasAugment(rules, capturedPiece.color, 'undying') &&
    (revives[capturedPiece.color] ?? 0) > 0
  ) {
    const home = respawnSquare(board, capturedPiece.color);
    if (home !== null) {
      board[home] = { kind: 'c', color: capturedPiece.color, kinged: false, id: nextId++ };
      revives[capturedPiece.color] = (revives[capturedPiece.color] ?? 0) - 1;
    }
  }

  const record: MoveRecord = {
    ...move,
    promotes,
    kind: mover.kind,
    color: mover.color,
    capturedKind: capturedPiece?.kind ?? null,
    chained: state.chain !== null,
    notation: notate(mover, move, capturedPiece?.kind ?? null, promotes),
  };

  const base: GameState = {
    ...state,
    board,
    nextId,
    revives,
    history: [...state.history, record],
  };

  // Taking the King ends it immediately.
  if (capturedPiece?.kind === 'K') {
    return finish(base, mover.color, 'king-capture');
  }

  // A hop that can continue keeps the turn with the same piece. Crowning stops
  // the chain as in standard checkers, unless `relentless` says otherwise.
  const crownStops = promotes && !hasAugment(rules, mover.color, 'relentless');
  if (move.isJump && !crownStops) {
    const more = movesForPiece(board, move.to, rules).filter((m) => m.isJump);
    if (more.length > 0) {
      return { ...base, chain: move.to };
    }
  }

  return startTurn({ ...base, chain: null, turn: other(state.turn) });
}

export const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

/** Settle the position at the start of a turn: if the side to move is stuck,
 *  decide the game per the ruleset. */
function startTurn(state: GameState): GameState {
  // Fuses burn down before the side to move gets to act, so an armed piece
  // cannot be walked out of trouble on the very turn it was due to go off.
  const ticked = tickBombs(state);
  if (ticked.status === 'over') return ticked;
  if (legalMoves(ticked).length > 0) return ticked;
  return ticked.rules.lossOnNoMoves
    ? finish(ticked, other(ticked.turn), 'no-moves')
    : finish(ticked, null, 'no-moves');
}

function finish(state: GameState, winner: Color | null, reason: WinReason): GameState {
  return { ...state, status: 'over', winner, winReason: reason, chain: null };
}

export function resign(state: GameState, who: Color): GameState {
  return finish(state, other(who), 'resign');
}

// ---------------------------------------------------------------------------
// Queries used by the UI
// ---------------------------------------------------------------------------

export function pieceAt(state: GameState, s: Sq): Piece | null {
  return at(state.board, s);
}

/** Pieces a side has lost, for the captured-piece tray. */
export function capturedBy(state: GameState, color: Color): Kind[] {
  return state.history
    .filter((m) => m.color === color && m.capturedKind !== null)
    .map((m) => m.capturedKind as Kind);
}

export function materialCount(state: GameState, color: Color): number {
  return state.board.reduce((n, p) => (p && p.color === color ? n + 1 : n), 0);
}
