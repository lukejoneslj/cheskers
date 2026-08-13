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

export const at = (board: Board, s: Sq): Piece | null => board[s] ?? null;

const isEnemy = (p: Piece | null, color: Color): p is Piece =>
  p !== null && p.color !== color;

/** The row a checker of this colour must reach to be crowned. */
const crownRow = (color: Color): number => (color === 'w' ? 0 : 7);

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
  };
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

function checkerMoves(board: Board, from: Sq, piece: Piece, out: Move[]): void {
  const forward = piece.color === 'w' ? -1 : 1;
  const dirs = piece.kinged
    ? DIAGONAL
    : ([[forward, 1], [forward, -1]] as ReadonlyArray<readonly [number, number]>);
  const crown = crownRow(piece.color);

  for (const [dr, dc] of dirs) {
    const r = row(from) + dr;
    const c = col(from) + dc;
    if (!onBoard(r, c)) continue;
    const over = sq(r, c);
    const neighbour = at(board, over);

    if (!neighbour) {
      out.push({
        from,
        to: over,
        captured: null,
        isJump: false,
        promotes: !piece.kinged && r === crown,
      });
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
      promotes: !piece.kinged && jr === crown,
    });
  }
}

/** Every pseudo-legal move for the piece on `from`, ignoring compulsory
 *  capture and whose turn it is. */
export function movesForPiece(board: Board, from: Sq): Move[] {
  const piece = at(board, from);
  if (!piece) return [];
  const out: Move[] = [];
  switch (piece.kind) {
    case 'R': slide(board, from, piece.color, ORTHOGONAL, out); break;
    case 'B': slide(board, from, piece.color, DIAGONAL, out); break;
    case 'Q': slide(board, from, piece.color, OMNI, out); break;
    case 'N': step(board, from, piece.color, KNIGHT, out); break;
    case 'K': step(board, from, piece.color, OMNI, out); break;
    case 'c': checkerMoves(board, from, piece, out); break;
  }
  return out;
}

/** Every legal move for the side to move, with compulsory capture and any
 *  in-progress jump chain applied. */
export function legalMoves(state: GameState): Move[] {
  if (state.status === 'over') return [];

  // Mid-chain: only the jumping piece may act, and only by jumping again.
  if (state.chain !== null) {
    return movesForPiece(state.board, state.chain).filter((m) => m.isJump);
  }

  const all: Move[] = [];
  for (let s = 0; s < 64; s++) {
    if (at(state.board, s)?.color === state.turn) {
      all.push(...movesForPiece(state.board, s));
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

function notate(
  piece: Piece,
  move: Move,
  capturedKind: Kind | null,
  promotes: boolean,
): string {
  const label = piece.kind === 'c' ? (piece.kinged ? 'C' : 'c') : piece.kind;
  const link = move.isJump ? 'x' : capturedKind ? 'x' : '–';
  return (
    `${label}${squareName(move.from)}${link}${squareName(move.to)}` +
    (promotes ? '=C' : '')
  );
}

/** Apply a legal move, returning a brand new state. The input is never mutated,
 *  which keeps undo, network replay and animation snapshots trivial. */
export function applyMove(state: GameState, move: Move): GameState {
  const board = state.board.slice() as (Piece | null)[];
  const mover = at(board, move.from);
  if (!mover) throw new Error(`no piece on square ${move.from}`);

  const capturedPiece = move.captured !== null ? at(board, move.captured) : null;
  if (move.captured !== null) board[move.captured] = null;
  board[move.from] = null;

  const promotes = move.promotes && mover.kind === 'c' && !mover.kinged;
  const moved: Piece = promotes ? { ...mover, kinged: true } : mover;
  board[move.to] = moved;

  const record: MoveRecord = {
    ...move,
    kind: mover.kind,
    color: mover.color,
    capturedKind: capturedPiece?.kind ?? null,
    chained: state.chain !== null,
    notation: notate(mover, move, capturedPiece?.kind ?? null, promotes),
  };

  const base: GameState = {
    ...state,
    board,
    history: [...state.history, record],
  };

  // Taking the King ends it immediately.
  if (capturedPiece?.kind === 'K') {
    return finish(base, mover.color, 'king-capture');
  }

  // A hop that can continue keeps the turn with the same piece. Crowning stops
  // the chain, matching standard checkers.
  if (move.isJump && !promotes) {
    const more = movesForPiece(board, move.to).filter((m) => m.isJump);
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
