/* =====================================================================
   SECTION 1: CONSTANTS
   No Phaser this time, just a plain <canvas> element and its 2D drawing
   context (`ctx`). Everything we draw goes through `ctx`.
   ===================================================================== */

const SQUARE = 70;          // each square is 70x70 pixels (8 squares = 560px, matching the canvas size)
const LIGHT = '#f0d9b5';
const DARK = '#b58863';

const PIECE_UNICODE = {
  w: { R: '♖', N: '♘', B: '♗', Q: '♕', K: '♔' },
  b: { R: '♜', N: '♞', B: '♝', Q: '♛', K: '♚' }
};

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d'); // the "pen" we use to draw everything
const turnText = document.getElementById('turnText');
const messageText = document.getElementById('messageText');
const restartBtn = document.getElementById('restartBtn');


/* =====================================================================
   SECTION 2: THE BOARD "DATA" (the game's brain)
   -------------------------------------------------------------------
   Identical to the Phaser version - this part doesn't care what's
   drawing the picture. The board is an 8x8 grid, each cell either
   `null` (empty) or an object like { kind: 'R', color: 'w' }.
   ===================================================================== */

function createInitialBoard() {
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  const backRank = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
  for (let c = 0; c < 8; c++) {
    board[0][c] = { kind: backRank[c], color: 'b' };
    board[1][c] = { kind: 'c', color: 'b', kinged: false };
    board[6][c] = { kind: 'c', color: 'w', kinged: false };
    board[7][c] = { kind: backRank[c], color: 'w' };
  }
  return board;
}

function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
function isEnemy(cell, color) { return cell && cell.color !== color; }


/* =====================================================================
   SECTION 3: MOVEMENT RULES
   -------------------------------------------------------------------
   Also unchanged from the Phaser version. This is the proof that the
   "engine" part of a game and the "renderer" part are genuinely
   separate concerns - none of this logic knows or cares whether Phaser
   or Canvas is drawing the result.
   ===================================================================== */

function slidingMoves(board, r, c, color, dirs) {
  const moves = [], captures = [];
  for (const [dr, dc] of dirs) {
    let nr = r + dr, nc = c + dc;
    while (inBounds(nr, nc)) {
      const cell = board[nr][nc];
      if (!cell) {
        moves.push({ r: nr, c: nc });
      } else {
        if (isEnemy(cell, color)) captures.push({ r: nr, c: nc });
        break;
      }
      nr += dr; nc += dc;
    }
  }
  return { moves, captures };
}

function stepMoves(board, r, c, color, offsets) {
  const moves = [], captures = [];
  for (const [dr, dc] of offsets) {
    const nr = r + dr, nc = c + dc;
    if (!inBounds(nr, nc)) continue;
    const cell = board[nr][nc];
    if (!cell) moves.push({ r: nr, c: nc });
    else if (isEnemy(cell, color)) captures.push({ r: nr, c: nc });
  }
  return { moves, captures };
}

function getPieceMoves(board, r, c) {
  const cell = board[r][c];
  if (!cell) return { moves: [], captures: [] };
  const color = cell.color;

  if (cell.kind === 'R') return slidingMoves(board, r, c, color, [[1,0],[-1,0],[0,1],[0,-1]]);
  if (cell.kind === 'B') return slidingMoves(board, r, c, color, [[1,1],[1,-1],[-1,1],[-1,-1]]);
  if (cell.kind === 'Q') return slidingMoves(board, r, c, color, [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]);
  if (cell.kind === 'N') return stepMoves(board, r, c, color, [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]]);
  if (cell.kind === 'K') return stepMoves(board, r, c, color, [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]);

  if (cell.kind === 'c') {
    const forward = color === 'w' ? -1 : 1;
    const dirs = cell.kinged
      ? [[forward,1],[forward,-1],[-forward,1],[-forward,-1]]
      : [[forward,1],[forward,-1]];
    const moves = [], captures = [];
    for (const [dr, dc] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (inBounds(nr, nc) && !board[nr][nc]) moves.push({ r: nr, c: nc });
      const jr = r + 2*dr, jc = c + 2*dc;
      if (inBounds(nr, nc) && inBounds(jr, jc) && board[nr][nc] && isEnemy(board[nr][nc], color) && !board[jr][jc]) {
        captures.push({ r: jr, c: jc, capR: nr, capC: nc });
      }
    }
    return { moves, captures };
  }
  return { moves: [], captures: [] };
}


/* =====================================================================
   SECTION 4: ACTUALLY MOVING A PIECE
   ===================================================================== */

function movePiece(board, fromR, fromC, toR, toC, captureInfo) {
  const piece = board[fromR][fromC];
  board[fromR][fromC] = null;
  let capturedKing = false;

  if (captureInfo) {
    const captured = board[captureInfo.capR][captureInfo.capC];
    if (captured && captured.kind === 'K') capturedKing = true;
    board[captureInfo.capR][captureInfo.capC] = null;
  } else if (board[toR][toC] && board[toR][toC].kind === 'K') {
    capturedKing = true;
  }

  board[toR][toC] = piece;

  if (piece.kind === 'c') {
    if ((piece.color === 'w' && toR === 0) || (piece.color === 'b' && toR === 7)) piece.kinged = true;
  }
  return capturedKing;
}


/* =====================================================================
   SECTION 5: GAME STATE
   -------------------------------------------------------------------
   With Phaser, this state lived as properties on a Scene object
   (`this.board`, `this.turn`, etc). With no engine, we just keep it in
   one plain JavaScript object. Functionally identical idea.
   ===================================================================== */

let state = {
  board: createInitialBoard(),
  turn: 'w',
  selected: null,
  legalMoves: [],
  legalCaptures: [],
  mustContinue: null,
  gameOver: false,
  winner: null
};

function resetGame() {
  state = {
    board: createInitialBoard(),
    turn: 'w',
    selected: null,
    legalMoves: [],
    legalCaptures: [],
    mustContinue: null,
    gameOver: false,
    winner: null
  };
  render();
}


/* =====================================================================
   SECTION 6: DRAWING (this is the section that replaces Phaser)
   -------------------------------------------------------------------
   Canvas has no "objects" to create and clear like Phaser's groups did -
   instead you just clear the WHOLE canvas and redraw everything from
   scratch each time, top to bottom, like painting over a canvas (hence
   the name). That's genuinely simpler to reason about for a game this
   size: there's no "what shapes exist right now" bookkeeping at all.
   ===================================================================== */

function cellCenter(r, c) {
  return { x: c * SQUARE + SQUARE / 2, y: r * SQUARE + SQUARE / 2 };
}

function render() {
  // Wipe the entire canvas clean before redrawing.
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // --- Checkered background ---
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? LIGHT : DARK;
      ctx.fillRect(c * SQUARE, r * SQUARE, SQUARE, SQUARE);
    }
  }

  // --- Highlights ---
  if (state.selected) {
    const { x, y } = cellCenter(state.selected.r, state.selected.c);
    ctx.fillStyle = 'rgba(255, 255, 0, 0.35)';
    ctx.fillRect(x - SQUARE / 2, y - SQUARE / 2, SQUARE, SQUARE);
  }
  for (const m of state.legalMoves) {
    const { x, y } = cellCenter(m.r, m.c);
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(68, 204, 68, 0.9)';
    ctx.fill();
  }
  for (const m of state.legalCaptures) {
    const { x, y } = cellCenter(m.r, m.c);
    ctx.beginPath();
    ctx.arc(x, y, 26, 0, Math.PI * 2);
    ctx.strokeStyle = '#cc3333';
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  // --- Pieces ---
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = state.board[r][c];
      if (!cell) continue;
      const { x, y } = cellCenter(r, c);

      if (cell.kind === 'c') {
        // Checkers piece: filled circle with an outline.
        ctx.beginPath();
        ctx.arc(x, y, 24, 0, Math.PI * 2);
        ctx.fillStyle = cell.color === 'w' ? '#f5f5f5' : '#333333';
        ctx.fill();
        ctx.strokeStyle = cell.color === 'w' ? '#333333' : '#f5f5f5';
        ctx.lineWidth = 3;
        ctx.stroke();

        if (cell.kinged) {
          ctx.font = '20px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = cell.color === 'w' ? '#b8860b' : '#ffd700';
          ctx.fillText('★', x, y);
        }
      } else {
        // Chess piece: draw the unicode glyph as text.
        ctx.font = '46px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = cell.color === 'w' ? '#ffffff' : '#111111';
        ctx.strokeStyle = cell.color === 'w' ? '#000000' : '#ffffff';
        ctx.lineWidth = 1.5;
        const glyph = PIECE_UNICODE[cell.color][cell.kind];
        ctx.strokeText(glyph, x, y);
        ctx.fillText(glyph, x, y);
      }
    }
  }

  // --- Status text (plain HTML elements, not drawn on the canvas) ---
  if (state.gameOver) {
    turnText.textContent = (state.winner === 'w' ? 'White' : 'Black') + ' wins!';
    messageText.textContent = 'King captured. Click Restart to play again.';
  } else {
    turnText.textContent = (state.turn === 'w' ? 'White' : 'Black') + "'s turn";
    messageText.textContent = state.mustContinue ? 'Multi-jump! Continue jumping with the same piece.' : '';
  }
}


/* =====================================================================
   SECTION 7: CLICK HANDLING
   -------------------------------------------------------------------
   With Phaser we listened via `this.input.on('pointerdown', ...)`.
   With plain JS/Canvas, we use the browser's own built-in click event
   and manually work out which square was clicked based on the click
   position relative to the canvas's top-left corner.
   ===================================================================== */

canvas.addEventListener('click', (event) => {
  if (state.gameOver) return;

  // getBoundingClientRect() tells us where the canvas sits on the page,
  // so we can convert a page click position into a position INSIDE the
  // canvas (0,0 at its top-left corner).
  const rect = canvas.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const clickY = event.clientY - rect.top;

  const c = Math.floor(clickX / SQUARE);
  const r = Math.floor(clickY / SQUARE);
  if (!inBounds(r, c)) return;

  // Case 1: mid multi-jump - only accept continuing the jump.
  if (state.mustContinue) {
    const cap = state.legalCaptures.find(m => m.r === r && m.c === c);
    if (cap) executeCapture(state.mustContinue.r, state.mustContinue.c, cap);
    return;
  }

  const clickedCell = state.board[r][c];

  // Case 2: a piece is already selected.
  if (state.selected) {
    const simple = state.legalMoves.find(m => m.r === r && m.c === c);
    const cap = state.legalCaptures.find(m => m.r === r && m.c === c);

    if (cap) { executeCapture(state.selected.r, state.selected.c, cap); return; }
    if (simple) { executeSimpleMove(state.selected.r, state.selected.c, r, c); return; }

    if (clickedCell && clickedCell.color === state.turn) {
      selectPiece(r, c);
      return;
    }

    state.selected = null; state.legalMoves = []; state.legalCaptures = [];
    render();
    return;
  }

  // Case 3: nothing selected yet.
  if (clickedCell && clickedCell.color === state.turn) {
    selectPiece(r, c);
  }
});

restartBtn.addEventListener('click', resetGame);


/* =====================================================================
   SECTION 8: GAME ACTIONS
   -------------------------------------------------------------------
   Same logic as the Phaser version's scene methods, just written as
   plain functions instead of class methods (no `this` needed).
   ===================================================================== */

function selectPiece(r, c) {
  const { moves, captures } = getPieceMoves(state.board, r, c);
  state.selected = { r, c };
  state.legalMoves = moves;
  state.legalCaptures = captures;
  render();
}

function executeSimpleMove(fromR, fromC, toR, toC) {
  movePiece(state.board, fromR, fromC, toR, toC, null);
  state.turn = state.turn === 'w' ? 'b' : 'w';
  state.selected = null; state.legalMoves = []; state.legalCaptures = []; state.mustContinue = null;
  render();
}

function executeCapture(fromR, fromC, cap) {
  const capturedKing = movePiece(state.board, fromR, fromC, cap.r, cap.c, cap);

  if (capturedKing) {
    state.gameOver = true;
    state.winner = state.turn;
    state.selected = null; state.legalMoves = []; state.legalCaptures = []; state.mustContinue = null;
    render();
    return;
  }

  const movedPiece = state.board[cap.r][cap.c];
  if (movedPiece.kind === 'c') {
    const next = getPieceMoves(state.board, cap.r, cap.c);
    if (next.captures.length > 0) {
      state.mustContinue = { r: cap.r, c: cap.c };
      state.selected = { r: cap.r, c: cap.c };
      state.legalMoves = [];
      state.legalCaptures = next.captures;
      render();
      return;
    }
  }

  state.turn = state.turn === 'w' ? 'b' : 'w';
  state.selected = null; state.legalMoves = []; state.legalCaptures = []; state.mustContinue = null;
  render();
}


/* =====================================================================
   SECTION 9: BOOT
   -------------------------------------------------------------------
   No engine to configure or `new Phaser.Game(...)` call needed - we
   just draw the initial position once, and every click after this
   triggers a fresh render() on its own.
   ===================================================================== */

render();
