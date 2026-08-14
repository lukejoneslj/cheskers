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
  // off a move: a guarded King wears its shield from move one.
  for (const color of ['w', 'b'] as Color[]) {
    if (!hasAugment(rules, color, 'royal_guard')) continue;
    const kingSq = board.findIndex((p) => p?.kind === 'K' && p.color === color);
    const king = kingSq >= 0 ? board[kingSq] : null;
    if (king) board[kingSq] = { ...king, shield: true };
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

  if (move.captured !== null) board[move.captured] = null;
  board[move.from] = null;

  // `bloodcrown` crowns a man the moment it takes something, wherever it is.
  const bloodcrown =
    move.captured !== null && hasAugment(rules, mover.color, 'bloodcrown');
  const promotes =
    mover.kind === 'c' && !mover.kinged && (move.promotes || bloodcrown);
  const moved: Piece = promotes ? { ...mover, kinged: true } : mover;
  board[move.to] = moved;

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
  if (legalMoves(state).length > 0) return state;
  return state.rules.lossOnNoMoves
    ? finish(state, other(state.turn), 'no-moves')
    : finish(state, null, 'no-moves');
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
