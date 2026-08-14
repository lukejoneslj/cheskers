/** The multiplayer lobby: create or join a room, then keep the local game in
 *  step with the shared move log.
 *
 * All the networking lives in `net/room.ts`; this module is only the glue
 * between a room snapshot and the `App`. The important invariant is that the
 * local game is never driven by remote *state* — only by remote *moves*, each
 * re-validated against our own engine before it is played.
 */

import { rollLoadout } from '../engine/augments';
import type { Outcome } from '../engine/elo';
import { DEFAULT_RULES, type Color, type Move, type Rules } from '../engine/types';
import { accounts, cleanName } from '../net/auth';
import { Room, type RoomSnapshot, type Seat, type WireMove } from '../net/room';
import { isConfigured } from '../net/firebase';
import type { App } from './app';
import type { MatchPeer } from './match-peer';
import { screens } from './screens';
import { sound } from './sound';

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
};

/** Augments rolled per side when a room is created in Mania mode. */
const MANIA_AUGMENTS = 3;

export class Lobby implements MatchPeer {
  private readonly room: Room;
  private peer: MatchPeer | null = null;
  private seat: Seat = 'spectator';
  private generation = -1;
  private joined = false;
  /** Kept so a failed write can be rolled back against the server's version
   *  of the game rather than left diverged. */
  private lastSnapshot: RoomSnapshot | null = null;
  /** Both sides' ratings, captured when the pairing is made. Using the rating
   *  as it stood at the start keeps the exchange symmetric even if one client
   *  scores the game before the other. */
  private ratingsAtStart: Partial<Record<Color, { rating: number; games: number }>> = {};
  private ratedGeneration = -1;

  private readonly dom = {
    modal: el('lobby-modal'),
    setup: el('lobby-setup'),
    home: el('lobby-home'),
    waiting: el('lobby-waiting'),
    name: el<HTMLInputElement>('lobby-name'),
    code: el<HTMLInputElement>('lobby-code'),
    roomCode: el('room-code'),
    status: el('lobby-status'),
    error: el('lobby-error'),
    mania: el<HTMLInputElement>('lobby-mania'),
    create: el<HTMLButtonElement>('lobby-create'),
    join: el<HTMLButtonElement>('lobby-join'),
    copy: el<HTMLButtonElement>('lobby-copy'),
    close: el<HTMLButtonElement>('lobby-close'),
    leave: el<HTMLButtonElement>('lobby-leave'),
  };

  constructor(private readonly app: App) {
    this.room = new Room({
      onSnapshot: (snapshot) => this.onSnapshot(snapshot),
      onError: (message) => this.showError(message),
      onRejected: (move, reason) => this.onRejected(move, reason),
    });
    this.bind();
  }

  /** The AI opponent takes the same board binding this does; each has to
   *  yield it before starting its own match. */
  setPeer(peer: MatchPeer): void {
    this.peer = peer;
  }

  // -------------------------------------------------------------------------

  private bind(): void {
    window.addEventListener('cheskers:open-lobby', () => this.open());

    window.addEventListener('cheskers:gameover', () => {
      if (!this.joined || this.seat === 'spectator') return;
      // Best effort: the result is already implied by the move log, this just
      // stops the room advertising itself as still in progress.
      void this.room.reportResult('over').catch(() => undefined);
      void this.applyRating();
    });

    window.addEventListener('cheskers:resign', () => {
      void this.room.resign().catch((error: unknown) => {
        this.showError(
          `Could not tell your opponent you resigned: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    });

    window.addEventListener('cheskers:rematch', () => {
      void this.room.offerRematch().catch((error: unknown) => {
        this.showError(
          `Rematch failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    });

    this.dom.close.addEventListener('click', () => {
      this.dom.modal.hidden = true;
    });

    this.dom.leave.addEventListener('click', () => {
      this.leave();
    });

    this.dom.create.addEventListener('click', () => {
      this.peer?.leave();
      void this.guard(this.dom.create, async () => {
        const code = await this.room.create(this.currentRules(), this.playerName());
        this.seat = 'w';
        this.joined = true;
        this.showWaiting(code);
      });
    });

    this.dom.join.addEventListener('click', () => {
      const code = this.dom.code.value.trim().toUpperCase();
      if (code.length < 4) {
        this.showError('Enter the four-character room code');
        return;
      }
      this.peer?.leave();
      void this.guard(this.dom.join, async () => {
        this.seat = await this.room.join(code, this.playerName());
        this.joined = true;
        this.showWaiting(code);
      });
    });

    this.dom.copy.addEventListener('click', () => {
      const url = new URL(window.location.href);
      url.searchParams.set('room', this.room.roomCode);
      void navigator.clipboard
        .writeText(url.toString())
        .then(() => {
          this.dom.copy.textContent = 'COPIED!';
          window.setTimeout(() => (this.dom.copy.textContent = 'COPY LINK'), 1600);
        })
        .catch(() => this.showError('Could not copy — select the code manually'));
    });

    // The lobby name and the profile name are the same thing — otherwise a
    // player shows as BOB in the game and PLAYER on the leaderboard.
    accounts.onChange(({ profile }) => {
      if (profile && document.activeElement !== this.dom.name) {
        this.dom.name.value = profile.name;
      }
    });
    this.dom.name.addEventListener('change', () => {
      void accounts.setName(this.dom.name.value).catch(() => undefined);
    });

    // Deep link: /?room=ABCD drops straight into the lobby with the code
    // filled in, which is what makes "send your friend a link" work.
    const invited = new URLSearchParams(window.location.search).get('room');
    if (invited) {
      this.dom.code.value = invited.toUpperCase();
      this.open();
    }
  }

  private open(): void {
    this.dom.modal.hidden = false;
    this.dom.error.textContent = '';
    if (!isConfigured()) {
      this.dom.setup.hidden = false;
      this.dom.home.hidden = true;
      this.dom.waiting.hidden = true;
      return;
    }
    this.dom.setup.hidden = true;
    this.dom.home.hidden = this.joined;
    this.dom.waiting.hidden = !this.joined;
  }

  private playerName(): string {
    const typed = this.dom.name.value.trim();
    const name = cleanName(typed || accounts.current.profile?.name || '');
    // Persist it so the leaderboard and the game agree on what to call you.
    if (typed) void accounts.setName(typed).catch(() => undefined);
    return name;
  }

  /** The ruleset a newly created room is fixed to.
   *
   * Deliberately built from `DEFAULT_RULES` rather than from whatever the
   * local game is currently set to. The rule toggles live under "LOCAL GAME
   * OPTIONS" and there is nothing in the lobby that shows a joiner what the
   * host picked — inheriting them would let a stray checkbox silently change
   * the game for someone who never saw it. Online is always the standard
   * ruleset: no forced jumps.
   *
   * Augments are the one exception, and they are rolled here and stored in
   * the room, so both clients read the same loadout and their engines cannot
   * disagree about what a move meant. */
  private currentRules(): Rules {
    return {
      ...DEFAULT_RULES,
      augments: this.dom.mania.checked ? rollLoadout(MANIA_AUGMENTS) : {},
    };
  }

  /** Run an async action with the button disabled and errors surfaced. */
  private async guard(button: HTMLButtonElement, action: () => Promise<void>): Promise<void> {
    const label = button.textContent;
    button.disabled = true;
    button.textContent = '...';
    this.dom.error.textContent = '';
    try {
      await action();
    } catch (error) {
      this.showError(error instanceof Error ? error.message : String(error));
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  private showError(message: string): void {
    this.dom.error.textContent = message;
  }

  private showWaiting(code: string): void {
    this.dom.home.hidden = true;
    this.dom.setup.hidden = true;
    this.dom.waiting.hidden = false;
    this.dom.leave.hidden = false;
    this.dom.roomCode.textContent = code;
  }

  leave(): void {
    this.room.leave();
    this.joined = false;
    this.seat = 'spectator';
    this.generation = -1;
    this.dom.leave.hidden = true;
    this.dom.modal.hidden = true;
    this.ratingsAtStart = {};
    this.ratedGeneration = -1;
    this.app.setBinding({ control: 'both' });
    this.app.setPresence({});
    this.app.setRatings({});
    this.app.showRatingChange(null);
    this.app.setModePanel(null);
    this.app.resetForMatch({ ...this.app.getState().rules, augments: {} });
  }

  // -------------------------------------------------------------------------
  // Snapshot handling
  // -------------------------------------------------------------------------

  private onSnapshot(snapshot: RoomSnapshot): void {
    this.seat = snapshot.seat;
    this.lastSnapshot = snapshot;

    // A new generation means a rematch was agreed and the move log was
    // cleared, so the local board has to go back to the starting position.
    if (snapshot.generation !== this.generation) {
      this.generation = snapshot.generation;
      this.room.resetApplied();
      this.app.resetForMatch(snapshot.rules);
    }

    this.app.setBinding({
      control: snapshot.seat === 'spectator' ? 'none' : snapshot.seat,
      names: snapshot.names,
      onLocalMove: (move) => this.publish(move),
    });
    this.app.setPresence(snapshot.online);

    const mania =
      (snapshot.rules.augments?.w?.length ?? 0) > 0 ||
      (snapshot.rules.augments?.b?.length ?? 0) > 0;
    this.app.setModeLabel(
      `${mania ? 'ONLINE MANIA' : 'ONLINE'} · ROOM ${snapshot.code}`,
    );
    this.app.setModePanel({
      title: 'ONLINE',
      action: 'ROOM',
      onClick: () => this.open(),
    });
    // Sitting down at a room means leaving the menu behind.
    screens.show('game');

    this.applyPending(snapshot);

    // A concession is not a move, so it arrives as its own flag rather than in
    // the move log. Ignore our own — that board is already finished.
    if (snapshot.resigned && snapshot.resigned !== snapshot.seat) {
      this.app.applyRemoteResign(snapshot.resigned);
    }

    this.updateStatus(snapshot);
    void this.syncRatings(snapshot);
  }

  /** Fetch both players' ratings once a pairing exists, and show them. */
  private async syncRatings(snapshot: RoomSnapshot): Promise<void> {
    const { w, b } = snapshot.uids;
    if (!w || !b) return;
    // Only re-read at the start of a game; mid-game the displayed numbers
    // should not move under the players.
    if (this.ratedGeneration === snapshot.generation && this.ratingsAtStart.w) return;
    this.ratedGeneration = snapshot.generation;
    try {
      const [white, black] = await Promise.all([accounts.ratingOf(w), accounts.ratingOf(b)]);
      this.ratingsAtStart = { w: white, b: black };
      this.app.setRatings({ w: white.rating, b: black.rating });
    } catch {
      // A missing rating is not worth interrupting a game over.
    }
  }

  /** Score the finished game against the local player's own record. */
  private async applyRating(): Promise<void> {
    const snapshot = this.lastSnapshot;
    const seat = this.seat;
    if (!snapshot || seat === 'spectator') return;

    const opponentSeat: Color = seat === 'w' ? 'b' : 'w';
    const opponent = this.ratingsAtStart[opponentSeat];
    if (!opponent) return;

    const state = this.app.getState();
    if (state.status !== 'over') return;
    const outcome: Outcome =
      state.winner === null ? 'draw' : state.winner === seat ? 'win' : 'loss';

    try {
      const change = await accounts.applyResult(
        opponent,
        outcome,
        snapshot.code,
        snapshot.generation,
      );
      this.app.showRatingChange(change);
    } catch (error) {
      console.warn('rating update failed', error);
    }
  }

  /** Play through any moves we have not yet seen, validating each one. */
  private applyPending(snapshot: RoomSnapshot): void {
    for (const wire of this.room.pending(snapshot)) {
      const legal = this.room.validate(wire, this.app.getState());
      if (!legal) return; // stop at the first bad move rather than desyncing
      this.room.noteApplied();
      this.app.applyRemoteMove(legal);
    }
  }

  private publish(move: Move): void {
    if (this.seat === 'spectator') return;
    // The move is already on our own board, so count it as delivered before
    // the echo arrives — otherwise we would replay our own move.
    this.room.noteApplied();
    void this.room.send(move).catch((error: unknown) => {
      this.showError(
        `Move rejected by the server (${
          error instanceof Error ? error.message : String(error)
        }). Board restored to the last agreed position.`,
      );
      // The move was applied optimistically and then refused. Without this the
      // local board would stay a move ahead of the server for the rest of the
      // game, and every later move would fail validation against the peer.
      this.resync();
    });
  }

  /** Rebuild the local game from the server's move log, discarding anything
   *  this client applied optimistically. */
  private resync(): void {
    const snapshot = this.lastSnapshot;
    if (!snapshot) return;
    this.room.resetApplied();
    this.app.resetForMatch(snapshot.rules);
    this.applyPending(snapshot);
  }

  private onRejected(move: WireMove, reason: string): void {
    this.showError(
      `Ignored a move from your opponent (${reason}). ` +
      `If this keeps happening the game may be out of sync — try a rematch.`,
    );
    console.warn('rejected remote move', move, reason);
  }

  private updateStatus(snapshot: RoomSnapshot): void {
    const { status } = this.dom;
    const opponent: Color | null =
      snapshot.seat === 'w' ? 'b' : snapshot.seat === 'b' ? 'w' : null;

    if (snapshot.seat === 'spectator') {
      status.textContent = 'Both seats are taken — you are spectating.';
      status.classList.remove('live');
      return;
    }
    if (!opponent || !snapshot.names[opponent]) {
      status.textContent = 'Waiting for an opponent…';
      status.classList.remove('live');
      return;
    }
    const online = snapshot.online[opponent];
    status.textContent = online
      ? `${snapshot.names[opponent]} is connected. You are ${
          snapshot.seat === 'w' ? 'White' : 'Black'
        }.`
      : `${snapshot.names[opponent]} has disconnected — waiting for them to return…`;
    status.classList.toggle('live', Boolean(online));

    if (online && this.dom.modal.hidden === false && snapshot.status === 'playing') {
      // Once the match is genuinely under way, get out of the player's way.
      this.dom.modal.hidden = true;
      sound.tick();
    }
  }
}
