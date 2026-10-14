/* The world behind the panels. Every screen with a sky gets a toggle that tucks its panels away so the world
 * fills the screen (remembered per screen), a way back to the whole scene once the eye has wandered, and the
 * measure of the open sky between its panels, which the scene centres itself on. */
import { h } from '../core/dom';
import { icon } from './frame';

const EYE = 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6z';
const PANELS = 'M3 5h7v14H3zM14 5h7v14h-7z';
const WHOLE = 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5';

const storeKey = (screen: string) => `wyrmhold.world.${screen}`;
function remembered(screen: string) { try { return localStorage.getItem(storeKey(screen)) === '1'; } catch { return false; } }
function remember(screen: string, on: boolean) { try { if (on) localStorage.setItem(storeKey(screen), '1'); else localStorage.removeItem(storeKey(screen)); } catch { /* a private window forgets */ } }

export interface WorldView {
  /** The controls, for the top bar. */
  el: HTMLElement;
  readonly on: boolean;
  set(on: boolean): void;
  /** The eye has wandered from the whole scene: offer the way back. */
  moved(m: boolean): void;
  onChange(fn: (on: boolean) => void): () => void;
  dispose(): void;
}

/** The "look at the world" toggle for one screen (and, with `home`, a "whole isle" button shown once the camera moves). */
export function worldView(screen: string, opts: { home?: () => void; homeLabel?: string } = {}): WorldView {
  let on = remembered(screen);
  const subs = new Set<(on: boolean) => void>();
  const toggle = h('button', { type: 'button', class: 'btn small world-btn', 'aria-label': 'Look at the world', onclick: () => set(!on) });
  const home = opts.home ? h('button', { type: 'button', class: 'btn small world-home', hidden: true, title: 'Back to the whole view', onclick: () => { opts.home!(); toggle.focus({ preventScroll: true }); } },
    icon(WHOLE, 16), h('span', { class: 't' }, opts.homeLabel || 'Whole isle')) : null;
  const el = h('div', { class: 'world-ctl', role: 'group', 'aria-label': 'The world' }, home, toggle);
  function paint() {
    toggle.setAttribute('aria-pressed', String(on));
    toggle.title = on ? 'Bring the panels back (Esc)' : 'Tuck the panels away and look at the world';
    toggle.textContent = '';
    toggle.append(icon(on ? PANELS : EYE, 16), h('span', { class: 't' }, on ? 'Show panels' : 'World'));
    document.body.classList.toggle('world-view', on);
  }
  function set(v: boolean) { if (v === on) return; on = v; remember(screen, on); paint(); subs.forEach((f) => f(on)); }
  // Escape brings the panels back, unless a dialog is open (Escape is its own)
  const esc = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !on || e.defaultPrevented || document.querySelector('.veil, .gloss, .tour, [role="dialog"][aria-modal="true"]')) return;
    set(false); toggle.focus({ preventScroll: true });
  };
  document.addEventListener('keydown', esc);
  paint();
  return {
    el, get on() { return on; }, set,
    moved(m) { if (home) home.hidden = !m; },
    onChange(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    dispose() { document.removeEventListener('keydown', esc); subs.clear(); document.body.classList.remove('world-view'); },
  };
}

/** A phone held upright stacks its panels under a window onto the sky; one held sideways stacks them in a column
 * on the right (styles.css), so the sky keeps the left. */
export const PHONE_UPRIGHT = '(max-width: 720px)';
export const PHONE_SIDEWAYS = '(min-width: 721px) and (max-height: 560px)';

/** Where the open sky is, in pixels from the canvas's middle, and how big it is beside the whole canvas. */
export interface Gap { dx: number; dy: number; w: number; h: number; cw: number; ch: number }

/** The open sky the warden sees: the canvas less the panels at its sides, the bars above and below it. On a
 * phone held upright it is the window left above the stacked panels (as far as it is still on screen). */
export function openSky(canvas: HTMLElement, parts: { sides?: (Element | null)[]; tops?: (Element | null)[]; bottoms?: (Element | null)[]; window?: Element | null }): Gap | null {
  const c = canvas.getBoundingClientRect();
  if (c.width < 2 || c.height < 2) return null;
  const cx = c.left + c.width / 2, cy = c.top + c.height / 2;
  const whole: Gap = { dx: 0, dy: 0, w: c.width, h: c.height, cw: c.width, ch: c.height };
  if (document.body.classList.contains('world-view')) return whole;
  const box = (e: Element | null | undefined) => { if (!e || !e.isConnected) return null; const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < innerHeight ? r : null; };
  let L = Math.max(c.left, 0), R = Math.min(c.right, innerWidth), T = Math.max(c.top, 0), B = Math.min(c.bottom, innerHeight);
  const win = parts.window ? box(parts.window) : null;
  if (win) { T = Math.max(T, win.top); B = Math.min(B, win.bottom); }
  else {
    // a panel that straddles the middle is a band, not a side (a notice across the top, a bar of rites)
    for (const e of parts.sides || []) {
      const r = box(e);
      if (!r || (r.left < cx - 20 && r.right > cx + 20)) continue;
      if (r.left + r.width / 2 < cx) L = Math.max(L, r.right); else R = Math.min(R, r.left);
    }
    // bars above and below count only where they hang over the open sky (not a bar in the side column)
    const mid = (L + R) / 2, over = (r: DOMRect) => r.left < mid && r.right > mid;
    for (const e of parts.tops || []) { const r = box(e); if (r && over(r) && r.top < cy) T = Math.max(T, r.bottom); }
    for (const e of parts.bottoms || []) { const r = box(e); if (r && over(r) && r.top > cy) B = Math.min(B, r.top); }
  }
  if (R - L < 80 || B - T < 60) return null;
  // never more than a quarter of the canvas off its middle
  const lim = (v: number, m: number) => Math.max(-m / 4, Math.min(m / 4, v));
  return { dx: lim((L + R) / 2 - cx, c.width), dy: lim((T + B) / 2 - cy, c.height), w: R - L, h: B - T, cw: c.width, ch: c.height };
}

/** How much further back to stand so a scene framed for a gap `design` of the canvas wide fits the gap there is. */
export const fitFor = (g: Gap, design: number, most = 1.5) => Math.max(1, Math.min(most, design / Math.max(0.05, g.w / g.cw)));

/** Measure the open sky again whenever it may have moved (a resize, a scroll, the panels tucked away or back), at most once a frame. */
export function keepFramed(measure: () => void) {
  let raf = 0;
  const soon = () => { if (!raf) raf = requestAnimationFrame(() => { raf = requestAnimationFrame(() => { raf = 0; measure(); }); }); };
  window.addEventListener('resize', soon);
  // scroll does not bubble: listen in the capture phase to hear the page and any panel layer that scrolls
  window.addEventListener('scroll', soon, { capture: true, passive: true });
  return { soon, dispose() { cancelAnimationFrame(raf); window.removeEventListener('resize', soon); window.removeEventListener('scroll', soon, { capture: true }); } };
}
