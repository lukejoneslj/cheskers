/** Runs the AI search off the main thread.
 *
 * A `hard` search can legitimately take a couple of seconds; doing that on
 * the main thread would freeze the board's animation loop for the whole
 * search. `GameState` is plain data (no functions, no class instances), so it
 * survives `postMessage`'s structured clone without any special handling.
 */

import { chooseMove, DIFFICULTIES } from './ai';
import type { Move } from './types';
import type { AiRequest, AiResponse } from './ai.protocol';

self.onmessage = (e: MessageEvent<AiRequest>) => {
  const { requestId, state, difficulty } = e.data;
  const move: Move | null = chooseMove(state, DIFFICULTIES[difficulty]);
  const response: AiResponse = { requestId, move };
  (self as unknown as Worker).postMessage(response);
};
