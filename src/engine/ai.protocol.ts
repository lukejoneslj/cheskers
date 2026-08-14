/** Message shapes shared between the AI worker and whoever drives it. Kept in
 *  its own module so both sides import the same types without either one
 *  having to import the other. */

import type { GameState, Move } from './types';
import type { DIFFICULTIES } from './ai';

export interface AiRequest {
  requestId: number;
  state: GameState;
  difficulty: keyof typeof DIFFICULTIES;
}

export interface AiResponse {
  requestId: number;
  move: Move | null;
}
