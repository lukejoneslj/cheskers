/** Application controller: owns the game state and keeps the DOM and the
 *  canvas in step with it.
 *
 * The board renderer knows nothing about rules and the engine knows nothing
 * about pixels; this module is the only place the two meet. It also exposes a
 * `MatchBinding` seam so an online match can restrict which colour the local
 * player is allowed to touch without any of this logic changing.
 */

import {
  applyMove,
  capturedBy,
  initialState,
  legalMoves,
  legalMovesFrom,
  materialCount,
  resign,
} from '../engine/rules';
import {
  type Color,
  type GameState,
  type Kind,
  type Move,
  type Rules,
  type Sq,
  DEFAULT_RULES,
  squareName,
} from '../engine/types';
import { augment } from '../engine/augments';
import { BoardView } from '../render/board-view';
import { SpriteAtlas, spriteKey } from '../render/sprites';
import { music } from './music';
import { sound } from './sound';

export interface MatchBinding {
  /** Which side this client drives: `both` for hotseat, a colour for an online
   *  seat, `none` for a spectator. */
  control: 'both' | Color | 'none';
  /** Called after the local player commits a move, for network broadcast. */
  onLocalMove?: (move: Move, state: GameState) => void;
  /** Label shown on each player card. */
  names?: Partial<Record<Color, string>>;
}

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
};

const KIND_LABEL: Record<Kind, string> = {
  K: 'King', Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight', c: 'Checker',
};

export class App {
  private state: GameState;
  private view!: BoardView;
  private readonly atlas = new SpriteAtlas();

  private selected: Sq | null = null;
  private targets: Move[] = [];
  private flipped = false;
  private binding: MatchBinding = { control: 'both' };
  private presence: Partial<Record<Color, boolean>> = {};
  private ratings: Partial<Record<Color, number>> = {};
  private rules: Rules = { ...DEFAULT_RULES };
  private hintTimer = 0;

  private readonly dom = {
    canvas: el<HTMLCanvasElement>('board'),
    frame: el('board-frame'),
    banner: el('banner'),
    bannerText: el('banner-text'),
    hint: el('hint'),
    log: el<HTMLOListElement>('log'),
    ranks: el('ranks'),
    files: el('files'),
    overModal: el('over-modal'),
    overTitle: el('over-title'),
    overBody: el('over-body'),
    helpModal: el('help-modal'),
    modeLabel: el('game-mode-label'),
    modePanel: el('mode-panel'),
    modePanelTitle: el('mode-panel-title'),
    modeAction: el<HTMLButtonElement>('btn-mode-action'),
    btnResign: el<HTMLButtonElement>('btn-resign'),
    optForced: el<HTMLInputElement>('opt-forced'),
    optStuck: el<HTMLInputElement>('opt-stuck'),
  };

  constructor() {
    this.state = initialState(this.rules);
  }

  async start(): Promise<void> {
    await this.atlas.load();

    this.view = new BoardView(this.dom.canvas, this.atlas, {
      onSquare: (square) => this.handleSquare(square),
      onAnimationEnd: () => this.afterAnimation(),
    });

    this.bindControls();
    this.buildCoordinates();
    window.addEventListener('resize', () => this.fit());

    // The grid column can still measure as zero on the first frame after a
    // reload, which would pin the board to its minimum size. Watching the
    // container re-fits as soon as layout actually settles, and also covers
    // the reflow when the pixel font finishes loading.
    const host = this.dom.frame.parentElement;
    if (host && 'ResizeObserver' in window) {
      let lastWidth = 0;
      new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width ?? 0;
        // Only react to width: the canvas drives its own height, so reacting
        // to that would feed back into this observer.
        if (width > 0 && Math.abs(width - lastWidth) > 0.5) {
          lastWidth = width;
          this.fit();
        }
      }).observe(host);
    }

    // rAF is paused while the tab is hidden, so an animation started just
    // before the player switched away would still be mid-flight on return.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.view.busy) {
        this.view.settle(this.state);
        this.afterAnimation();
      }
    });

    this.fit();
    this.view.reset(this.state);
    this.view.start();
    this.refresh();
  }

  // -------------------------------------------------------------------------
  // Sizing
  // -------------------------------------------------------------------------

  private fit(): void {
    // Leave room for the frame's padding and border, and never let the board
    // grow taller than the viewport.
    const frameChrome = 46;
    const MAX_BOARD = 800;

    // Either measurement can legitimately read as zero for a frame -- before
    // first layout, or while the tab is hidden. Treating a zero as a real
    // constraint would pin the board to its minimum and leave it there, so an
    // unusable measurement is dropped rather than clamped.
    const limits: number[] = [MAX_BOARD];
    const hostWidth = this.dom.frame.parentElement?.clientWidth ?? 0;
    if (hostWidth > 1) limits.push(hostWidth);
    else if (window.innerWidth > 1) limits.push(window.innerWidth - 32);
    if (window.innerHeight > 200) limits.push(window.innerHeight - 190);

    const available = Math.min(...limits);
    this.view.resize(Math.max(180, available - frameChrome));
    this.buildCoordinates();
  }

  private buildCoordinates(): void {
    const files = [...'abcdefgh'];
    const ranks = [8, 7, 6, 5, 4, 3, 2, 1];
    const shownFiles = this.flipped ? [...files].reverse() : files;
    const shownRanks = this.flipped ? [...ranks].reverse() : ranks;
    this.dom.files.innerHTML = shownFiles.map((f) => `<span>${f}</span>`).join('');
    this.dom.ranks.innerHTML = shownRanks.map((r) => `<span>${r}</span>`).join('');
  }

  // -------------------------------------------------------------------------
  // Controls
  // -------------------------------------------------------------------------

  private bindControls(): void {
    // In an online match a player cannot simply restart their own board —
    // both sides have to agree, so the request goes out over the network and
    // the reset arrives back as a new generation.
    const restart = () => {
      const seated = this.binding.control === 'w' || this.binding.control === 'b';
      if (seated) {
        window.dispatchEvent(new CustomEvent('cheskers:rematch'));
        this.setHint('REMATCH OFFERED — WAITING FOR OPPONENT');
        this.dom.overModal.hidden = true;
        return;
      }
      this.newGame();
    };
    el('btn-new').addEventListener('click', restart);
    el('over-again').addEventListener('click', restart);
    el('over-close').addEventListener('click', () => {
      this.dom.overModal.hidden = true;
    });

    el('btn-flip').addEventListener('click', () => {
      this.flipped = !this.flipped;
      this.view.setFlipped(this.flipped);
      this.buildCoordinates();
      sound.tick();
    });

    this.dom.btnResign.addEventListener('click', () => {
      if (this.state.status === 'over') return;
      const { control } = this.binding;
      const who = control === 'both' || control === 'none' ? this.state.turn : control;
      this.state = resign(this.state, who);
      // Online, the opponent's client has to be told — otherwise they sit
      // waiting for a move that will never come.
      if (control === 'w' || control === 'b') {
        window.dispatchEvent(new CustomEvent('cheskers:resign'));
      }
      this.refresh();
      this.showGameOver();
    });

    // Sound and help each appear twice -- once on the menu, once on the board
    // -- so both copies drive the same handler and stay in step.
    for (const id of ['btn-help', 'btn-help-game']) {
      document.getElementById(id)?.addEventListener('click', () => {
        this.dom.helpModal.hidden = false;
      });
    }
    el('help-close').addEventListener('click', () => {
      this.dom.helpModal.hidden = true;
    });

    const soundButtons = ['btn-sound', 'btn-sound-game']
      .map((id) => document.getElementById(id))
      .filter((node): node is HTMLElement => node !== null);
    const soundIcons = ['sound-icon', 'sound-icon-game']
      .map((id) => document.getElementById(id))
      .filter((node): node is HTMLElement => node !== null);
    for (const button of soundButtons) {
      button.addEventListener('click', () => {
        sound.unlock();
        music.unlock();
        const muted = !sound.muted;
        sound.setMuted(muted);
        music.setMuted(muted);
        for (const b of soundButtons) b.setAttribute('aria-pressed', String(muted));
        for (const icon of soundIcons) icon.textContent = muted ? '🔇' : '♪';
        if (!muted) sound.tick();
      });
    }

    const applyRules = () => {
      // Spread the current ruleset rather than rebuilding it: augments are
      // part of `rules` too, and a checkbox must not quietly discard them.
      this.rules = {
        ...this.rules,
        forcedJumps: this.dom.optForced.checked,
        lossOnNoMoves: this.dom.optStuck.checked,
      };
      // Rule changes apply to the running game; re-derive the current
      // selection because what is legal may have just changed.
      this.state = { ...this.state, rules: this.rules };
      this.clearSelection();
      this.refresh();
      sound.tick();
    };
    this.dom.optForced.addEventListener('change', applyRules);
    this.dom.optStuck.addEventListener('change', applyRules);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!this.dom.helpModal.hidden) this.dom.helpModal.hidden = true;
        else if (!this.dom.overModal.hidden) this.dom.overModal.hidden = true;
        else this.clearSelection(), this.refresh();
      }
      if (e.key === 'f') el('btn-flip').click();
      if (e.key === 'n') this.newGame();
    });

    el('mode-online').addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('cheskers:open-lobby'));
    });
  }

  /** Name of the mode currently in play, shown in the board screen's header
   *  so it is always obvious what you are in the middle of. */
  setModeLabel(label: string): void {
    this.dom.modeLabel.textContent = label;
  }

  /** Optional mode-owned button in the board screen's sidebar — "END RUN"
   *  for Mania, "CHAPTERS" for the campaign. Pass null to hide it. */
  setModePanel(
    panel: { title: string; action: string; onClick: () => void } | null,
  ): void {
    if (!panel) {
      this.dom.modePanel.hidden = true;
      this.dom.modeAction.onclick = null;
      return;
    }
    this.dom.modePanel.hidden = false;
    this.dom.modePanelTitle.textContent = panel.title;
    this.dom.modeAction.textContent = panel.action;
    this.dom.modeAction.onclick = () => panel.onClick();
  }

  setBinding(binding: MatchBinding): void {
    const seatChanged = this.binding.control !== binding.control;
    this.binding = binding;
    // Show a player their own side at the bottom, but only when they are first
    // seated — flipping under them later would be disorienting.
    if (seatChanged && binding.control === 'b') {
      this.flipped = true;
      this.view.setFlipped(true);
      this.buildCoordinates();
    }
    this.refresh();
  }

  /** Mark which online seats are currently connected. */
  setPresence(presence: Partial<Record<Color, boolean>>): void {
    this.presence = presence;
    this.refresh();
  }

  /** Show each side's Elo rating on their player card. */
  setRatings(ratings: Partial<Record<Color, number>>): void {
    this.ratings = ratings;
    this.refresh();
  }

  /** Display the rating movement from the game just finished. */
  showRatingChange(change: { before: number; after: number; delta: number } | null): void {
    const panel = el('rating-change');
    if (!change) {
      panel.hidden = true;
      return;
    }
    el('rating-before').textContent = String(change.before);
    el('rating-after').textContent = String(change.after);
    const delta = el('rating-delta');
    delta.textContent = change.delta > 0 ? `+${change.delta}` : String(change.delta);
    delta.dataset.dir = change.delta > 0 ? 'up' : change.delta < 0 ? 'down' : 'flat';
    panel.hidden = false;
  }

  /** Start a fresh game under a given ruleset — used when an online match
   *  begins or a rematch is agreed. */
  resetForMatch(rules: Rules): void {
    this.rules = rules;
    this.dom.optForced.checked = rules.forcedJumps;
    this.dom.optStuck.checked = rules.lossOnNoMoves;
    this.newGame();
  }

  getState(): GameState {
    return this.state;
  }

  /** Persistent status line under the board, used by the game modes to say
   *  which run or chapter is in progress. */
  showHint(text: string): void {
    this.setHint(text);
  }

  // -------------------------------------------------------------------------
  // Turn flow
  // -------------------------------------------------------------------------

  newGame(): void {
    this.state = initialState(this.rules);
    this.clearSelection();
    this.view.reset(this.state);
    this.dom.overModal.hidden = true;
    this.setHint('');
    this.refresh();
    sound.tick();
    // Between games, the "selecting game mode" track plays; the first move
    // played hands off to the gameplay pair, see playMoveSounds().
    music.enterMenu();
  }

  /** True when the local player is allowed to act right now. */
  private get myTurn(): boolean {
    const { control } = this.binding;
    if (control === 'none') return false;
    return control === 'both' || control === this.state.turn;
  }

  private handleSquare(square: Sq): void {
    sound.unlock();
    music.unlock();
    if (this.state.status === 'over') return;

    // Never drop a click just because something is still animating. Snapping
    // the board to its finished state keeps the game responsive under fast
    // play, and means a stalled animation can never lock the player out.
    if (this.view.busy) {
      this.view.settle(this.state);
      this.afterAnimation();
    }

    if (!this.myTurn) {
      this.warn('WAITING FOR OPPONENT');
      return;
    }

    const target = this.targets.find((m) => m.to === square);
    if (target) {
      this.play(target);
      return;
    }

    // Mid-chain the piece is locked; clicking anywhere else is a no-op beyond
    // a reminder of what the player has to do.
    if (this.state.chain !== null) {
      this.warn('KEEP JUMPING WITH THE SAME PIECE');
      return;
    }

    const piece = this.state.board[square];
    if (piece && piece.color === this.state.turn) {
      this.select(square);
      return;
    }

    if (this.selected !== null) {
      this.clearSelection();
      sound.deselect();
      this.refresh();
      return;
    }

    if (piece) this.warn("THAT IS NOT YOUR PIECE");
  }

  private select(square: Sq): void {
    const moves = legalMovesFrom(this.state, square);
    if (moves.length === 0) {
      sound.illegal();
      const hasJump = legalMoves(this.state).some((m) => m.isJump);
      this.warn(
        hasJump && this.state.rules.forcedJumps
          ? 'FORCED JUMP — YOU MUST TAKE'
          : 'NO LEGAL MOVES FOR THAT PIECE',
      );
      return;
    }
    this.selected = square;
    this.targets = moves;
    this.setHint('');
    sound.select();
    this.refresh();
  }

  private clearSelection(): void {
    this.selected = null;
    this.targets = [];
  }

  private play(move: Move): void {
    const before = this.state;
    const after = applyMove(before, move);
    this.state = after;
    this.clearSelection();

    if (before.history.length === 0) music.enterGame();
    this.view.animate(before, move, after);
    this.playMoveSounds(before, move, after);

    this.binding.onLocalMove?.(move, after);

    this.setHint('');
    this.refresh();
  }

  /** Called by the network layer when the opponent concedes. */
  applyRemoteResign(who: Color): void {
    if (this.state.status === 'over') return;
    this.state = resign(this.state, who);
    this.clearSelection();
    this.refresh();
    this.showGameOver();
    window.setTimeout(() => sound.win(), 200);
  }

  /** Called by the network layer when the opponent moves. */
  applyRemoteMove(move: Move): void {
    const before = this.state;
    const after = applyMove(before, move);
    this.state = after;
    this.clearSelection();
    if (before.history.length === 0) music.enterGame();
    this.view.animate(before, move, after);
    this.playMoveSounds(before, move, after);
    this.refresh();
  }

  private playMoveSounds(before: GameState, move: Move, after: GameState): void {
    if (move.isJump) sound.jump();
    else sound.move();

    if (move.captured !== null) {
      // Line the crunch up with the moment the victim actually shatters.
      window.setTimeout(() => sound.capture(), move.isJump ? 210 : 150);
    }
    if (move.promotes) window.setTimeout(() => sound.crown(), 260);

    if (after.status === 'over') {
      const { control } = this.binding;
      // In hotseat there is no losing side to sympathise with, so the win
      // fanfare always plays.
      const won = control === 'both' || control === 'none'
        ? true
        : after.winner === control;
      window.setTimeout(() => (won ? sound.win() : sound.lose()), 480);
      if (after.winReason === 'king-capture' && move.captured !== null) {
        this.view.celebrate(move.captured);
      }
      void before;
    }
  }

  private afterAnimation(): void {
    // A chain leaves the turn with the same piece: re-arm its jumps so the
    // player can see immediately where they may continue.
    if (this.state.chain !== null && this.state.status === 'playing') {
      this.selected = this.state.chain;
      this.targets = legalMovesFrom(this.state, this.state.chain);
    }
    this.refresh();
    if (this.state.status === 'over') this.showGameOver();
  }

  // -------------------------------------------------------------------------
  // View sync
  // -------------------------------------------------------------------------

  private refresh(): void {
    this.view.setSelection(this.selected, this.targets);
    this.view.setChain(this.state.chain);
    this.view.setInteractive(this.state.status === 'playing' && this.myTurn);

    this.updateBanner();
    this.updatePlayers();
    this.updateLog();
    this.dom.btnResign.disabled = this.state.status === 'over';
  }

  private updateBanner(): void {
    const { banner, bannerText } = this.dom;
    if (this.state.status === 'over') {
      banner.dataset.state = 'over';
      banner.dataset.turn = '';
      bannerText.textContent = this.state.winner
        ? `${this.state.winner === 'w' ? 'WHITE' : 'BLACK'} WINS`
        : 'DRAW';
      return;
    }
    if (this.state.chain !== null) {
      banner.dataset.state = 'chain';
      banner.dataset.turn = this.state.turn;
      bannerText.textContent = 'MULTI-JUMP!';
      return;
    }
    banner.dataset.state = '';
    banner.dataset.turn = this.state.turn;
    const side = this.state.turn === 'w' ? 'WHITE' : 'BLACK';
    const seated = this.binding.control === 'w' || this.binding.control === 'b';
    bannerText.textContent = seated
      ? this.myTurn ? 'YOUR MOVE' : 'OPPONENT THINKING'
      : `${side} TO MOVE`;
  }

  private updatePlayers(): void {
    for (const color of ['w', 'b'] as Color[]) {
      const card = el(`card-${color}`);
      const active = this.state.status === 'playing' && this.state.turn === color;
      card.classList.toggle('active', active);
      // Only meaningful online; in hotseat there is nothing to be offline from.
      card.classList.toggle('offline', this.presence[color] === false);

      el(`count-${color}`).textContent = String(materialCount(this.state, color));

      const custom = this.binding.names?.[color];
      el(`name-${color}`).textContent =
        custom ?? (color === 'w' ? 'WHITE' : 'BLACK');

      const elo = el(`elo-${color}`);
      const rating = this.ratings[color];
      elo.textContent = rating === undefined ? '' : String(rating);
      elo.hidden = rating === undefined;

      this.renderAugments(color);

      const tray = el(`tray-${color}`);
      const taken = capturedBy(this.state, color);
      // Only append what is new so the pop animation does not replay for the
      // whole tray on every refresh.
      if (tray.childElementCount > taken.length) tray.replaceChildren();
      for (let i = tray.childElementCount; i < taken.length; i++) {
        const kind = taken[i]!;
        const victim = color === 'w' ? 'b' : 'w';
        const img = document.createElement('img');
        img.src = `${import.meta.env.BASE_URL}sprites/${spriteKey({
          kind,
          color: victim,
          kinged: false,
        })}.png`;
        img.alt = KIND_LABEL[kind];
        img.title = KIND_LABEL[kind];
        tray.appendChild(img);
      }
    }
  }

  /** Show a side's augments on its player card. Driven straight off the game
   *  state, so every mode that sets augments -- local Mania, online Mania, a
   *  campaign chapter -- gets this for free, and so you can always read what
   *  your opponent is playing with rather than having to infer it from a move
   *  you did not think was legal.
   *
   * The name is spelled out rather than left to a hover tooltip: the glyph
   * alone told you *that* a side had three augments and nothing about what
   * they did, and on a touch screen there is no hover at all. */
  private renderAugments(color: Color): void {
    const host = el(`aug-${color}`);
    const ids = this.state.rules.augments?.[color] ?? [];
    const signature = ids.join(',');
    if (host.dataset.signature === signature) return; // nothing changed
    host.dataset.signature = signature;

    host.replaceChildren();
    host.hidden = ids.length === 0;
    for (const id of ids) {
      const a = augment(id);
      const chip = document.createElement('span');
      chip.className = 'card-aug';
      chip.dataset.rarity = a.rarity;
      chip.title = `${a.name} — ${a.blurb}`;

      const glyph = document.createElement('span');
      glyph.className = 'card-aug-glyph';
      glyph.textContent = a.glyph;
      const name = document.createElement('span');
      name.className = 'card-aug-name';
      name.textContent = a.name;
      chip.append(glyph, name);
      host.appendChild(chip);
    }
  }

  private updateLog(): void {
    const { log } = this.dom;
    const history = this.state.history;
    if (history.length === 0) {
      log.innerHTML = '<li class="empty">No moves yet</li>';
      return;
    }
    if (log.firstElementChild?.classList.contains('empty')) log.replaceChildren();
    for (let i = log.childElementCount; i < history.length; i++) {
      const record = history[i]!;
      const li = document.createElement('li');
      li.dataset.color = record.color;
      li.dataset.capture = String(record.captured !== null);
      li.innerHTML =
        `<span class="ply">${i + 1}</span>` +
        `<span class="move">${record.notation}</span>`;
      log.appendChild(li);
    }
    while (log.childElementCount > history.length) log.lastElementChild!.remove();
    log.scrollTop = log.scrollHeight;
  }

  private showGameOver(): void {
    const { winner, winReason } = this.state;
    this.dom.overTitle.textContent = winner
      ? `${winner === 'w' ? 'WHITE' : 'BLACK'} WINS`
      : 'DRAW';
    const last = this.state.history.at(-1);
    this.dom.overBody.textContent =
      winReason === 'king-capture'
        ? `The king falls on ${last ? squareName(last.to) : 'the board'}.`
        : winReason === 'resign'
          ? 'Resigned.'
          : 'No legal moves remain.';
    this.dom.overModal.hidden = false;
    window.dispatchEvent(new CustomEvent('cheskers:gameover'));
    // Back to the pre-game track until a rematch or new game starts.
    music.enterMenu();
  }

  // -------------------------------------------------------------------------
  // Hints
  // -------------------------------------------------------------------------

  private setHint(text: string): void {
    this.dom.hint.textContent = text;
    this.dom.hint.classList.remove('warn');
  }

  private warn(text: string): void {
    const hint = this.dom.hint;
    hint.textContent = text;
    hint.classList.remove('warn');
    // Force a reflow so the shake animation restarts on a repeated warning.
    void hint.offsetWidth;
    hint.classList.add('warn');
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => this.setHint(''), 2200);
  }
}
