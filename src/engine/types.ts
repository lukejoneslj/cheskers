/** Core value types for the Cheskers rules engine.
 *
 * The engine is deliberately free of any DOM or rendering concern: it takes a
 * state and a move and hands back a new state. That keeps it unit-testable and
 * lets the exact same code run on both clients in a multiplayer match, so the
 * two peers can never disagree about what a move meant.
 */

export type Color = 'w' | 'b';

/** Chess piece kinds. Note there is no pawn: the second rank is checkers men. */
export type ChessKind = 'R' | 'N' | 'B' | 'Q' | 'K';

/** `c` is a checkers man (a "checker"); everything else moves as in chess. */
export type Kind = ChessKind | 'c';

/** A board index in `0..63`, laid out as `row * 8 + col`. Row 0 is Black's
 *  back rank at the top of the screen; row 7 is White's. White advances by
 *  decreasing row. */
export type Sq = number;

export interface Piece {
  kind: Kind;
  color: Color;
  /** Only meaningful for `kind === 'c'`: a crowned checker moves backwards too. */
  kinged: boolean;
  /** Stable across the whole game so the renderer can animate a piece as it
   *  travels rather than cross-fading two unrelated sprites. */
  id: number;
  /** Set by the `royal_guard` augment: absorbs one capture, then breaks.
   *  Optional so every position built without augments stays unchanged. */
  shield?: boolean;
}

// ---------------------------------------------------------------------------
// Augments (Cheskers Mania, and the campaign's opponents)
// ---------------------------------------------------------------------------

/** A rule modifier granted to one side. Each is deliberately expressible
 *  inside move generation or `applyMove`, so an augmented game is still the
 *  same pure engine — the AI needs no special handling to play against one. */
export type AugmentId =
  // Movement
  | 'backpedal'
  | 'flank'
  | 'flying_kings'
  | 'early_crown'
  | 'zealot_bishop'
  | 'siege_rook'
  | 'blink_king'
  | 'amazon_queen'
  | 'outrider_knight'
  // Consequences
  | 'royal_guard'
  | 'undying'
  | 'bloodcrown'
  | 'relentless';

/** Which augments each side is playing with. */
export type AugmentSet = Partial<Record<Color, ReadonlyArray<AugmentId>>>;

export function hasAugment(
  rules: Rules,
  color: Color,
  id: AugmentId,
): boolean {
  return rules.augments?.[color]?.includes(id) ?? false;
}

export type Board = ReadonlyArray<Piece | null>;

export interface Move {
  from: Sq;
  to: Sq;
  /** Square whose occupant this move removes, if any. For a chess capture that
   *  is the destination; for a checkers jump it is the square hopped over. */
  captured: Sq | null;
  /** True for a checkers hop. Drives both the compulsory-capture rule and the
   *  multi-jump chain. */
  isJump: boolean;
  /** True when the move crowns a checker on the far rank. */
  promotes: boolean;
}

export type WinReason = 'king-capture' | 'no-moves' | 'resign';

export interface MoveRecord extends Move {
  /** The moving piece's kind *before* the move, for notation. */
  kind: Kind;
  color: Color;
  /** Kind of the piece removed, if any. */
  capturedKind: Kind | null;
  /** True when this move was one link of a longer jump chain. */
  chained: boolean;
  notation: string;
}

export interface Rules {
  /** Classic checkers compulsory capture: if any hop is available, the side to
   *  move must hop. Exposed as a toggle because it can lock a player out of
   *  their chess pieces for a turn, which not everyone wants. */
  forcedJumps: boolean;
  /** If a side has no legal move, treat it as a loss (checkers convention)
   *  rather than a draw. */
  lossOnNoMoves: boolean;
  /** Per-side rule modifiers. Optional: a classic game has none, and rooms
   *  created before augments existed simply omit the field. */
  augments?: AugmentSet;
}

export const DEFAULT_RULES: Rules = {
  forcedJumps: false,
  lossOnNoMoves: true,
};

export interface GameState {
  board: Board;
  turn: Color;
  /** While a multi-jump is in progress, the square of the piece that must keep
   *  jumping. Null the rest of the time. */
  chain: Sq | null;
  status: 'playing' | 'over';
  winner: Color | null;
  winReason: WinReason | null;
  history: ReadonlyArray<MoveRecord>;
  rules: Rules;
  /** Monotonic counter used to seed piece ids. */
  nextId: number;
  /** Remaining `undying` respawns per side. Optional so hand-built test
   *  positions and pre-augment saved states stay valid. */
  revives?: Partial<Record<Color, number>>;
}

export const row = (sq: Sq): number => sq >> 3;
export const col = (sq: Sq): number => sq & 7;
export const sq = (r: number, c: number): Sq => r * 8 + c;
export const onBoard = (r: number, c: number): boolean =>
  r >= 0 && r < 8 && c >= 0 && c < 8;

/** Algebraic-style name for a square, e.g. square 0 is `a8`. */
export function squareName(s: Sq): string {
  return `${'abcdefgh'[col(s)]}${8 - row(s)}`;
}
