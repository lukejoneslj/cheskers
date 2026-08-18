/** Shared augment presentation: draft cards, held chips, and the hover card
 *  that explains what an augment actually does.
 *
 * Three places show augments — the local Mania draft, the online draft, and
 * the two player cards beside the board — and all three want the same answer
 * to "what does that thing do?". The native `title` tooltip was doing that
 * job badly: it takes a second to appear, cannot be styled to match anything,
 * and on a touch screen it never appears at all. This module replaces it with
 * one shared popup that opens on hover, on focus, and on tap.
 */

import { augment, type Augment } from '../engine/augments';
import type { AugmentId } from '../engine/types';

let tip: HTMLElement | null = null;
/** The element the tip is currently describing, so a tap on the same chip
 *  closes it again rather than re-opening it. */
let anchor: HTMLElement | null = null;

function tipNode(): HTMLElement {
  if (tip) return tip;
  const node = document.createElement('div');
  node.className = 'aug-tip';
  node.setAttribute('role', 'tooltip');
  node.hidden = true;
  node.innerHTML =
    `<span class="aug-tip-name"></span>` +
    `<span class="aug-tip-blurb"></span>` +
    `<span class="aug-tip-rarity"></span>`;
  document.body.appendChild(node);
  tip = node;

  // Anything else the player does dismisses it: a tip left hanging over the
  // board after a scroll or a click elsewhere is just in the way.
  window.addEventListener('scroll', hideTip, true);
  window.addEventListener('resize', hideTip);
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (anchor && !anchor.contains(event.target as Node)) hideTip();
    },
    true,
  );
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideTip();
  });
  return node;
}

function hideTip(): void {
  if (!tip) return;
  tip.hidden = true;
  anchor = null;
}

function showTip(host: HTMLElement, a: Augment): void {
  const node = tipNode();
  node.dataset.rarity = a.rarity;
  node.querySelector('.aug-tip-name')!.textContent = `${a.glyph} ${a.name}`;
  node.querySelector('.aug-tip-blurb')!.textContent = a.blurb;
  node.querySelector('.aug-tip-rarity')!.textContent = a.rarity.toUpperCase();
  node.hidden = false;
  anchor = host;

  // Position it after unhiding, so the measured size is the real one. Prefer
  // above the chip; flip below when there is no room, and keep it inside the
  // viewport horizontally either way.
  const box = host.getBoundingClientRect();
  const size = node.getBoundingClientRect();
  const margin = 8;
  let left = box.left + box.width / 2 - size.width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - size.width - margin));
  const above = box.top - size.height - margin;
  const top = above >= margin ? above : box.bottom + margin;
  node.style.left = `${Math.round(left)}px`;
  node.style.top = `${Math.round(top)}px`;
  node.dataset.side = above >= margin ? 'above' : 'below';
}

/** Wire an element up as an explainer for one augment. */
export function attachAugTip(host: HTMLElement, a: Augment): void {
  host.tabIndex = 0;
  host.setAttribute('aria-label', `${a.name} — ${a.blurb}`);
  host.addEventListener('mouseenter', () => showTip(host, a));
  host.addEventListener('mouseleave', hideTip);
  host.addEventListener('focus', () => showTip(host, a));
  host.addEventListener('blur', hideTip);
  // Touch has no hover, so a tap toggles the same popup.
  host.addEventListener('click', (event) => {
    event.preventDefault();
    if (anchor === host && tip && !tip.hidden) hideTip();
    else showTip(host, a);
  });
}

/** A full draft card: glyph, name, blurb, rarity. */
export function augCard(a: Augment): HTMLButtonElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'aug-card';
  card.dataset.rarity = a.rarity;
  card.innerHTML =
    `<span class="aug-glyph"></span>` +
    `<span class="aug-name"></span>` +
    `<span class="aug-blurb"></span>` +
    `<span class="aug-rarity"></span>`;
  card.querySelector('.aug-glyph')!.textContent = a.glyph;
  card.querySelector('.aug-name')!.textContent = a.name;
  card.querySelector('.aug-blurb')!.textContent = a.blurb;
  card.querySelector('.aug-rarity')!.textContent = a.rarity.toUpperCase();
  return card;
}

/** One row of held augments, labelled. Always rendered, empty or not: the
 *  opponent collects augments at exactly the rate you do, and hiding their
 *  row until they had one made it look like you were the only one rolling. */
export function renderHeld(
  host: HTMLElement,
  ids: ReadonlyArray<AugmentId>,
  label: string,
): void {
  host.replaceChildren();
  host.hidden = false;
  const tag = document.createElement('span');
  tag.className = 'held-label';
  tag.textContent = label;
  host.appendChild(tag);
  if (ids.length === 0) {
    const none = document.createElement('span');
    none.className = 'held-none';
    none.textContent = 'NOTHING YET';
    host.appendChild(none);
    return;
  }
  for (const id of ids) {
    const a = augment(id);
    const chip = document.createElement('span');
    chip.className = 'held-chip';
    chip.dataset.rarity = a.rarity;
    chip.textContent = `${a.glyph} ${a.name}`;
    attachAugTip(chip, a);
    host.appendChild(chip);
  }
}
