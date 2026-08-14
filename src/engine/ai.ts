/** A search-based opponent for Cheskers.
 *
 * Negamax with alpha-beta pruning over the same pure `legalMoves` /
 * `applyMove` the UI and the network layer already use, so the AI can never
 * see or play a move the rules engine wouldn't also accept from a human.
 *
 * The engine's multi-jump chain is a same-player "extra move": `applyMove`
 * returns a state whose `turn` hasn't changed. Every ply still costs one unit
 * of search depth, but the negamax sign flip -- and the alpha/beta window
 * negation that goes with it -- only happens when the mover actually changes,
 * otherwise the recursive call would score the position from the wrong
 * player's perspective.
 */

import { at, legalMoves, movesForPiece, applyMove } from './rules';
import type { Board, Color, GameState, Kind, Move, Rules } from './types';

export interface Difficulty {
  readonly label: string;
  readonly maxDepth: number;
  readonly timeBudgetMs: number;
  /** Chance [0,1) of playing a uniformly random legal move instead of the
   *  searched one -- the cheapest way to make a strong engine feel beatable
   *  rather than just shallow. */
  readonly randomness: number;
}

export const DIFFICULTIES: Record<'easy' | 'medium' | 'hard', Difficulty> = {
  easy: { label: 'Easy', maxDepth: 3, timeBudgetMs: 250, randomness: 0.25 },
  medium: { label: 'Medium', maxDepth: 6, timeBudgetMs: 900, randomness: 0.05 },
  hard: { label: 'Hard', maxDepth: 10, timeBudgetMs: 2200, randomness: 0 },
};

const PIECE_VALUE: Record<Kind, number> = {
  c: 100,
  N: 300,
  B: 320,
  R: 500,
  Q: 900,
  K: 0, // King safety is scored separately; material alone can't reflect it.
};
const KINGED_CHECKER_VALUE = 160;

const WIN_SCORE = 1_000_000;
const CENTER_SQUARES: ReadonlyArray<readonly [number, number]> = [
  [3, 3], [3, 4], [4, 3], [4, 4],
];

class SearchTimeout extends Error {}

/** Static evaluation of a non-terminal position, always from White's
 *  perspective (positive favours White). `negamax` flips the sign for Black
 *  itself, so this function never has to know whose turn it is. */
function evalWhite(state: GameState): number {
  const { board } = state;
  let score = 0;

  for (let s = 0; s < 64; s++) {
    const piece = at(board, s);
    if (!piece) continue;
    const sign = piece.color === 'w' ? 1 : -1;

    const value = piece.kind === 'c' && piece.kinged
      ? KINGED_CHECKER_VALUE
      : PIECE_VALUE[piece.kind];
    score += sign * value;

    if (piece.kind === 'c' && !piece.kinged) {
      const r = s >> 3;
      // Rows travelled toward the far rank -- White starts on row 6 marching
      // to row 0, Black starts on row 1 marching to row 7.
      const advanced = piece.color === 'w' ? 6 - r : r - 1;
      score += sign * advanced * 4;
    }

    if (piece.kind === 'N' || piece.kind === 'B' || piece.kind === 'Q') {
      const r = s >> 3;
      const c = s & 7;
      let centerDist = 8;
      for (const [cr, cc] of CENTER_SQUARES) {
        const d = Math.max(Math.abs(r - cr), Math.abs(c - cc));
        if (d < centerDist) centerDist = d;
      }
      score += sign * (3 - centerDist) * 6;
    }
  }

  for (const color of ['w', 'b'] as Color[]) {
    if (isKingHanging(board, color, state.rules)) score += color === 'w' ? -260 : 260;
  }

  return score;
}

/** True if any enemy piece has a pseudo-legal move landing on this colour's
 *  King -- i.e. the King would fall next move if nothing is done about it.
 *  Reuses the same move generator the UI highlights with, so "attacked" here
 *  means exactly what it would mean if the enemy actually played it. */
function isKingHanging(board: Board, color: Color, rules: Rules): boolean {
  let kingSq = -1;
  for (let s = 0; s < 64; s++) {
    const p = at(board, s);
    if (p && p.kind === 'K' && p.color === color) {
      // A shielded King shrugs off the first attempt, so being attacked is
      // not yet a threat worth panicking about.
      if (p.shield) return false;
      kingSq = s;
      break;
    }
  }
  if (kingSq === -1) return false;

  const enemy = color === 'w' ? 'b' : 'w';
  for (let s = 0; s < 64; s++) {
    const p = at(board, s);
    if (p?.color !== enemy) continue;
    if (movesForPiece(board, s, rules).some((m) => m.to === kingSq)) return true;
  }
  return false;
}

function orderedMoves(state: GameState): Move[] {
  const { board } = state;
  const score = (m: Move): number => {
    let s = 0;
    if (m.captured !== null) {
      const victim = at(board, m.captured);
      if (victim) {
        s += (victim.kind === 'c' && victim.kinged ? KINGED_CHECKER_VALUE : PIECE_VALUE[victim.kind]) * 10;
      }
    }
    if (m.isJump) s += 50;
    if (m.promotes) s += 80;
    return s;
  };
  return legalMoves(state)
    .map((m) => ({ m, s: score(m) }))
    .sort((a, b) => b.s - a.s)
    .map(({ m }) => m);
}

/** Score from the perspective of `state.turn`: positive if the side to move
 *  is already lost, positive on capture (see `terminalScore`) etc. */
function terminalScore(state: GameState, ply: number): number {
  if (state.winner === null) return 0;
  return state.winner === state.turn ? WIN_SCORE - ply : -(WIN_SCORE - ply);
}

interface SearchCtx {
  deadline: number;
  nodes: number;
}

function negamax(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  ctx: SearchCtx,
): number {
  ctx.nodes++;
  if ((ctx.nodes & 1023) === 0 && performance.now() > ctx.deadline) {
    throw new SearchTimeout();
  }

  if (state.status === 'over') return terminalScore(state, ply);
  if (depth === 0) {
    return (state.turn === 'w' ? 1 : -1) * evalWhite(state);
  }

  let best = -Infinity;
  for (const move of orderedMoves(state)) {
    const next = applyMove(state, move);
    const sameMover = next.turn === state.turn;
    const childScore = sameMover
      ? negamax(next, depth - 1, alpha, beta, ply + 1, ctx)
      : -negamax(next, depth - 1, -beta, -alpha, ply + 1, ctx);
    if (childScore > best) best = childScore;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/** One completed iterative-deepening pass, or `null` if the deadline hit
 *  before it finished -- in which case the caller keeps the previous depth's
 *  answer rather than trusting a partially-searched one. */
function searchRoot(
  state: GameState,
  depth: number,
  ctx: SearchCtx,
): { move: Move; score: number } | null {
  const moves = orderedMoves(state);
  let bestMove = moves[0]!;
  let best = -Infinity;
  try {
    for (const move of moves) {
      const next = applyMove(state, move);
      const sameMover = next.turn === state.turn;
      const score = sameMover
        ? negamax(next, depth - 1, -Infinity, Infinity, 1, ctx)
        : -negamax(next, depth - 1, -Infinity, Infinity, 1, ctx);
      if (score > best) {
        best = score;
        bestMove = move;
      }
    }
  } catch (e) {
    if (e instanceof SearchTimeout) return null;
    throw e;
  }
  return { move: bestMove, score: best };
}

/** Pick the AI's move for the current position. Runs synchronously -- the
 *  caller (see `ai.worker.ts`) is expected to be off the main thread, since
 *  a `hard` search can legitimately take a couple of seconds. */
export function chooseMove(state: GameState, difficulty: Difficulty): Move | null {
  const moves = legalMoves(state);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0]!;
  if (difficulty.randomness > 0 && Math.random() < difficulty.randomness) {
    return moves[Math.floor(Math.random() * moves.length)]!;
  }

  const ctx: SearchCtx = { deadline: performance.now() + difficulty.timeBudgetMs, nodes: 0 };
  let bestMove = moves[0]!;

  for (let depth = 1; depth <= difficulty.maxDepth; depth++) {
    const result = searchRoot(state, depth, ctx);
    if (result === null) break;
    bestMove = result.move;
    // A forced win/loss has been found -- searching deeper only spends time
    // without changing the answer.
    if (Math.abs(result.score) > WIN_SCORE - 1000) break;
    if (performance.now() > ctx.deadline) break;
  }
  return bestMove;
}
