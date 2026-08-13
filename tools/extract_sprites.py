#!/usr/bin/env python3
"""Cut the two source sprite sheets into individual transparent PNGs.

Both sheets are pixel art that was exported at a large integer-ish upscale, on a
solid background. We do three things:

  1. Key out the background with a flood fill seeded from the image border. A
     global colour match would punch holes in the white chess pieces, whose fill
     is the same white as the backdrop -- but every piece is ringed by a dark
     outline, so a fill that starts outside can never leak inside.
  2. Downsample back to the native pixel grid by sampling the centre of each
     art-pixel block, so the result is crisp at any integer zoom.
  3. Slice the grid into named pieces.

Run: python3 tools/extract_sprites.py
"""

from collections import Counter, deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets"
OUT = ROOT / "public" / "sprites"

# Column order as drawn in each sheet. Row 0 is the light army, row 1 the dark.
CHESS_COLS = ["pawn", "knight", "bishop", "rook", "king", "queen"]
CHECKERS_COLS = ["man", "king", "man_alt", "king_alt"]
COLORS = ["w", "b"]


def key_out_background(rgb: np.ndarray, tol: int = 70) -> np.ndarray:
    """Return an alpha mask (255 = keep) by flood filling in from the border."""
    h, w, _ = rgb.shape
    bg = rgb[0, 0].astype(int)
    # Candidate background: close to the corner colour. The flood fill then
    # restricts that to the region actually connected to the outside.
    close = np.abs(rgb.astype(int) - bg).sum(axis=2) <= tol

    out = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if close[y, x] and not out[y, x]:
                out[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if close[y, x] and not out[y, x]:
                out[y, x] = True
                q.append((y, x))

    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and close[ny, nx] and not out[ny, nx]:
                out[ny, nx] = True
                q.append((ny, nx))

    return np.where(out, 0, 255).astype(np.uint8)


def detect_block(rgb: np.ndarray) -> int:
    """Estimate the art-pixel block size from horizontal colour run lengths."""
    h, w, _ = rgb.shape
    counts = Counter()
    for y in range(0, h, 5):
        row = rgb[y].astype(int)
        start = 0
        for x in range(1, w):
            if np.abs(row[x] - row[x - 1]).sum() > 25:
                counts[x - start] += 1
                start = x
    # The true block size is the smallest run that explains most of the others.
    best, best_score = 1, -1
    for cand in range(6, 33):
        score = sum(n for length, n in counts.items()
                    if length >= cand and abs(length / cand - round(length / cand)) < 0.12)
        if score > best_score:
            best, best_score = cand, score
    return best


def downsample(rgba: np.ndarray, block: int) -> np.ndarray:
    """Sample the centre of each art-pixel block back to native resolution."""
    h, w, _ = rgba.shape
    nw, nh = max(1, round(w / block)), max(1, round(h / block))
    xs = ((np.arange(nw) + 0.5) * w / nw).astype(int).clip(0, w - 1)
    ys = ((np.arange(nh) + 0.5) * h / nh).astype(int).clip(0, h - 1)
    return rgba[np.ix_(ys, xs)]


def drop_specks(cell: np.ndarray, keep_ratio: float = 0.15) -> np.ndarray:
    """Erase disconnected fragments far smaller than the main silhouette.

    JPEG ringing along the sheet's cell boundaries leaves a few stray opaque
    pixels that survive the flood fill. Every real piece is one connected blob,
    so anything much smaller than the biggest blob is noise.
    """
    solid = cell[:, :, 3] > 0
    h, w = solid.shape
    label = np.zeros((h, w), dtype=int)
    sizes = [0]
    for sy in range(h):
        for sx in range(w):
            if not solid[sy, sx] or label[sy, sx]:
                continue
            n = len(sizes)
            sizes.append(0)
            q = deque([(sy, sx)])
            label[sy, sx] = n
            while q:
                y, x = q.popleft()
                sizes[n] += 1
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < h and 0 <= nx < w and solid[ny, nx] and not label[ny, nx]:
                            label[ny, nx] = n
                            q.append((ny, nx))
    if len(sizes) <= 1:
        return cell
    biggest = max(sizes)
    keep = {i for i, n in enumerate(sizes) if i and n >= biggest * keep_ratio}
    cell = cell.copy()
    cell[~np.isin(label, list(keep))] = 0
    return cell


def content_runs(flags: np.ndarray) -> list[tuple[int, int]]:
    runs, start = [], None
    for i, on in enumerate(flags):
        if on and start is None:
            start = i
        elif not on and start is not None:
            runs.append((start, i - 1))
            start = None
    if start is not None:
        runs.append((start, len(flags) - 1))
    return runs


def split_even(lo: int, hi: int, n: int) -> list[tuple[int, int]]:
    """Split an inclusive span into n even cells."""
    span = (hi - lo + 1) / n
    return [(lo + round(i * span), lo + round((i + 1) * span) - 1) for i in range(n)]


def process(path: Path, cols: list[str], prefix: str, block: int | None = None) -> None:
    rgb = np.asarray(Image.open(path).convert("RGB"))
    alpha = key_out_background(rgb)
    if block is None:
        block = detect_block(rgb)
    rgba = np.dstack([rgb, alpha])
    native = downsample(rgba, block)

    opaque = native[:, :, 3] > 0
    col_span = content_runs(opaque.any(axis=0))
    row_span = content_runs(opaque.any(axis=1))
    x0, x1 = col_span[0][0], col_span[-1][1]
    y0, y1 = row_span[0][0], row_span[-1][1]

    print(f"{path.name}: block={block} native={native.shape[1]}x{native.shape[0]} "
          f"content=({x0},{y0})-({x1},{y1})")

    OUT.mkdir(parents=True, exist_ok=True)
    for ri, (ry0, ry1) in enumerate(split_even(y0, y1, len(COLORS))):
        for ci, (cx0, cx1) in enumerate(split_even(x0, x1, len(cols))):
            name = cols[ci]
            if name.endswith("_alt"):
                continue
            cell = drop_specks(native[ry0:ry1 + 1, cx0:cx1 + 1])
            # Trim to the piece itself so every sprite is tight and we can
            # align them consistently at draw time.
            solid = cell[:, :, 3] > 0
            if not solid.any():
                continue
            ys, xs = np.where(solid)
            cell = cell[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
            out = OUT / f"{prefix}_{COLORS[ri]}_{name}.png"
            Image.fromarray(cell, "RGBA").save(out)
            print(f"  -> {out.name} {cell.shape[1]}x{cell.shape[0]}")


if __name__ == "__main__":
    # The two sheets were drawn at different resolutions. Reducing each to its
    # own native grid puts both armies on ONE shared pixel grid, so they can be
    # drawn at a single scale factor and still look like one art set. The
    # checkers sheet is nominally an 11x upscale, but 11 keeps it at roughly
    # double the chess density; 17 is the coarsest step that still resolves the
    # crown on a crowned man, and lands the pieces at 17-21 units against the
    # chess set's 15-21.
    process(SRC / "chess sprite sheet.jpg", CHESS_COLS, "chess", block=10)
    process(SRC / "checkers pieces spritesheet.jpeg", CHECKERS_COLS, "checkers", block=17)
