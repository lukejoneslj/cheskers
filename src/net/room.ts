/** Room lifecycle and move synchronisation over Firebase Realtime Database.
 *
 * The wire format is an append-only list of moves, not a board snapshot. Both
 * clients start from the same seeded position and replay the list through the
 * very same rules engine, so they cannot drift: there is no board state to
 * disagree about, only an ordered list of intents.
 *
 * On trust: database rules can stop a player writing to a seat that is not
 * theirs, and stop anyone rewriting a move already played, but they cannot run
 * the game engine, so they cannot tell a legal move from an illegal one. Every
 * incoming move is therefore re-validated locally against the engine before it
 * is applied, and rejected if it is not legal. That makes a tampered client
 * unable to force an illegal position on its opponent.
 */

import { findMove } from '../engine/rules';
import type { Color, GameState, Move, Rules } from '../engine/types';
import { connect, currentUid } from './firebase';

export type Seat = Color | 'spectator';

export interface RoomSnapshot {
  code: string;
  seat: Seat;
  rules: Rules;
  status: 'waiting' | 'playing' | 'over';
  names: Partial<Record<Color, string>>;
  /** Account ids, needed to look up each side's rating. */
  uids: Partial<Record<Color, string>>;
  online: Partial<Record<Color, boolean>>;
  /** Moves in play order, oldest first. */
  moves: WireMove[];
  rematchOffer: Color | null;
  /** Set to the seat that conceded, so the other client can end the game. */
  resigned: Color | null;
  generation: number;
}

/** The minimal move payload. Everything else about a move is re-derived from
 *  the engine, so a peer cannot smuggle in an inconsistent capture. */
export interface WireMove {
  from: number;
  to: number;
  by: Color;
}

export interface RoomEvents {
  onSnapshot(snapshot: RoomSnapshot): void;
  onError(message: string): void;
  /** Raised when a peer's move fails local validation. */
  onRejected(move: WireMove, reason: string): void;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1

export function makeCode(length = 4): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

interface RoomRecord {
  createdAt: number;
  generation: number;
  rules: Rules;
  status: 'waiting' | 'playing' | 'over';
  players?: Partial<Record<Color, { uid: string; name: string }>>;
  presence?: Partial<Record<Color, boolean>>;
  moves?: Record<string, WireMove>;
  rematchOffer?: Color | null;
  resigned?: Color | null;
}

export class Room {
  private code = '';
  private seat: Seat = 'spectator';
  private detach: Array<() => void> = [];
  /** Moves this client has already handed to the app, so a re-delivered
   *  snapshot does not replay them. */
  private appliedCount = 0;
  private generation = 0;

  constructor(private readonly events: RoomEvents) {}

  get roomCode(): string {
    return this.code;
  }

  get mySeat(): Seat {
    return this.seat;
  }

  // -------------------------------------------------------------------------

  async create(rules: Rules, name: string): Promise<string> {
    const { db } = await connect();
    const uid = await currentUid();
    const { ref, runTransaction, serverTimestamp } = await import('firebase/database');

    // A four-character code is short enough to read aloud, which means
    // collisions are possible. The transaction only commits when the slot is
    // genuinely empty, so two simultaneous creators cannot land on the same
    // room; on a clash we simply draw another code.
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = makeCode();
      const result = await runTransaction(
        ref(db, `rooms/${code}`),
        (current: RoomRecord | null) => {
          if (current) return undefined; // taken — abort this transaction
          return {
            createdAt: serverTimestamp() as unknown as number,
            generation: 0,
            rules,
            status: 'waiting',
            players: { w: { uid, name } },
            rematchOffer: null,
          } satisfies RoomRecord;
        },
      );
      if (result.committed) {
        this.code = code;
        this.seat = 'w';
        await this.listen();
        return code;
      }
    }
    throw new Error('Could not allocate a room code, please try again');
  }

  /** Join an existing room, taking a free seat or spectating if both are full. */
  async join(code: string, name: string): Promise<Seat> {
    const normalised = code.trim().toUpperCase();
    const { db } = await connect();
    const uid = await currentUid();
    const { ref, get, runTransaction } = await import('firebase/database');

    const existing = await get(ref(db, `rooms/${normalised}`));
    if (!existing.exists()) throw new Error(`No room called ${normalised}`);

    let seat: Seat = 'spectator';
    // Transact on the players node alone rather than the whole room, so the
    // database rules can forbid a client from ever rewriting the move log.
    type Players = RoomRecord['players'];
    await runTransaction(ref(db, `rooms/${normalised}/players`), (players: Players) => {
      const next: NonNullable<Players> = { ...(players ?? {}) };
      // Returning to a seat already held by this uid must not consume the
      // other seat, otherwise a refresh would turn one player into two.
      if (next.w?.uid === uid) seat = 'w';
      else if (next.b?.uid === uid) seat = 'b';
      else if (!next.w) {
        seat = 'w';
        next.w = { uid, name };
      } else if (!next.b) {
        seat = 'b';
        next.b = { uid, name };
      } else {
        seat = 'spectator';
        return players; // nothing to change; join as a spectator
      }
      return next;
    });

    if (seat !== 'spectator') {
      const { update } = await import('firebase/database');
      await update(ref(db, `rooms/${normalised}`), { status: 'playing' });
    }

    this.code = normalised;
    this.seat = seat;
    await this.listen();
    return seat;
  }

  // -------------------------------------------------------------------------

  private async listen(): Promise<void> {
    const { db } = await connect();
    const { ref, onValue, onDisconnect, set } = await import('firebase/database');

    if (this.seat !== 'spectator') {
      // Presence: flip our flag off automatically if the socket drops, so the
      // opponent sees "disconnected" rather than an unexplained silence.
      const presence = ref(db, `rooms/${this.code}/presence/${this.seat}`);
      await set(presence, true);
      await onDisconnect(presence).set(false);
      this.detach.push(() => void set(presence, false));
    }

    const roomRef = ref(db, `rooms/${this.code}`);
    const unsubscribe = onValue(
      roomRef,
      (snap) => {
        const record = snap.val() as RoomRecord | null;
        if (!record) {
          this.events.onError('This room no longer exists');
          return;
        }
        // Firebase keys sort lexicographically in push order, so sorting the
        // keys gives back the exact order the moves were played.
        const moves = Object.entries(record.moves ?? {})
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([, m]) => m);

        if (record.generation !== this.generation) {
          this.generation = record.generation;
          this.appliedCount = 0;
        }

        this.events.onSnapshot({
          code: this.code,
          seat: this.seat,
          rules: record.rules,
          status: record.status,
          names: {
            ...(record.players?.w ? { w: record.players.w.name } : {}),
            ...(record.players?.b ? { b: record.players.b.name } : {}),
          },
          uids: {
            ...(record.players?.w ? { w: record.players.w.uid } : {}),
            ...(record.players?.b ? { b: record.players.b.uid } : {}),
          },
          online: {
            w: record.presence?.w ?? false,
            b: record.presence?.b ?? false,
          },
          moves,
          rematchOffer: record.rematchOffer ?? null,
          resigned: record.resigned ?? null,
          generation: record.generation,
        });
      },
      (error) => this.events.onError(error.message),
    );
    this.detach.push(unsubscribe);
  }

  /** Publish a move the local player just made. */
  async send(move: Move): Promise<void> {
    if (this.seat === 'spectator') return;
    const { db } = await connect();
    const { ref, push, set } = await import('firebase/database');
    const wire: WireMove = { from: move.from, to: move.to, by: this.seat };
    await set(push(ref(db, `rooms/${this.code}/moves`)), wire);
  }

  /** Concede the game so the opponent's client can end it too. */
  async resign(): Promise<void> {
    if (this.seat === 'spectator') return;
    const { db } = await connect();
    const { ref, set } = await import('firebase/database');
    await set(ref(db, `rooms/${this.code}/resigned`), this.seat);
  }

  async reportResult(status: 'over'): Promise<void> {
    if (this.seat === 'spectator') return;
    const { db } = await connect();
    const { ref, update } = await import('firebase/database');
    await update(ref(db, `rooms/${this.code}`), { status });
  }

  /** Ask for a rematch. When both seats have asked, the board is cleared and
   *  the generation bumps, which is the signal every client uses to restart
   *  from move zero. */
  async offerRematch(): Promise<void> {
    if (this.seat === 'spectator') return;
    const seat = this.seat;
    const { db } = await connect();
    const { ref, get, runTransaction, update, remove } = await import('firebase/database');

    let agreed = false;
    await runTransaction(
      ref(db, `rooms/${this.code}/rematchOffer`),
      (offer: Color | null) => {
        if (offer && offer !== seat) {
          agreed = true;
          return null; // clear the offer; the reset happens below
        }
        return seat;
      },
    );

    if (!agreed) return;
    const generation = await get(ref(db, `rooms/${this.code}/generation`));
    await remove(ref(db, `rooms/${this.code}/moves`));
    await update(ref(db, `rooms/${this.code}`), {
      status: 'playing',
      resigned: null,
      generation: (Number(generation.val()) || 0) + 1,
    });
  }

  /** Moves in this snapshot that have not yet been handed to the game. */
  pending(snapshot: RoomSnapshot): WireMove[] {
    return snapshot.moves.slice(this.appliedCount);
  }

  /** Validate one peer move against the live position.
   *
   * This is the check the database rules cannot perform. A peer can only name
   * a from/to pair; the actual `Move` — what it captures, whether it crowns —
   * is re-derived here from our own engine, so a doctored client cannot invent
   * a capture that the rules do not allow.
   */
  validate(wire: WireMove, state: GameState): Move | null {
    if (state.turn !== wire.by) {
      this.events.onRejected(wire, 'move was played out of turn');
      return null;
    }
    const legal = findMove(state, wire.from, wire.to);
    if (!legal) {
      this.events.onRejected(wire, 'move is not legal in this position');
      return null;
    }
    return legal;
  }

  /** Count a move as delivered — whether it arrived from a peer or was played
   *  locally and optimistically applied before the echo came back. */
  noteApplied(): void {
    this.appliedCount++;
  }

  get applied(): number {
    return this.appliedCount;
  }

  resetApplied(): void {
    this.appliedCount = 0;
  }

  leave(): void {
    for (const off of this.detach) off();
    this.detach = [];
    this.code = '';
    this.seat = 'spectator';
    this.appliedCount = 0;
  }
}
