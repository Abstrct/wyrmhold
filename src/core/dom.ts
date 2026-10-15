/* The few DOM helpers the ledger modules (borrowed from the ledger client) ask for,
 * dressed for Wyrmhodl: a herald's scroll for toasts and a sealed-oath dialog for confirms. */
import { speak } from '../lore';
import { url } from './nav';

type Kind = '' | 'player' | 'enemy' | 'warn';
type Props = Record<string, unknown>;
type Child = Node | string | number | null | undefined | false | Child[];

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    // custom properties (--dx) only take through setProperty; Object.assign drops them silently
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v as Record<string, string>)) { if (sk.startsWith('--')) el.style.setProperty(sk, String(sv)); else (el.style as unknown as Record<string, string>)[sk] = sv; }
    else if (k === 'class') el.className = String(v);
    // a route ('/hold') becomes the site's address for it (core/nav.ts); '//host' and full URLs pass
    else if (k === 'href' && typeof v === 'string' && /^\/(?!\/)/.test(v)) el.setAttribute('href', url(v));
    else if (k in el && k !== 'list' && k !== 'form') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  const add = (c: Child) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : String(c));
  };
  children.forEach(add);
  return el;
}

export function clear(el: Element) { while (el.firstChild) el.removeChild(el.firstChild); }

/** Screens rebuild as the ledger moves. Rebuild `box` without throwing away the keyboard focus:
 * the control that had it (known by data-key, aria-label or its words) gets it back. */
export function keepFocus(box: Element, rebuild: () => void) {
  const id = (e: Element) => ((e as HTMLElement).dataset?.key || e.getAttribute('aria-label') || e.textContent || '').trim();
  const a = document.activeElement;
  const had = a && a !== document.body && box.contains(a) && !(a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) ? id(a) : null;
  rebuild();
  if (had == null || (document.activeElement && box.contains(document.activeElement))) return;
  const back = [...box.querySelectorAll('button, a[href], summary, select, [tabindex]')].find((e) => id(e) === had) as HTMLElement | undefined;
  back?.focus({ preventScroll: true });
}

/** A modal veil keeps the keyboard: focus goes in (to `first`, else its first control), Tab wraps inside it,
 * Escape closes it, and closing gives focus back to whatever opened it. Call once the veil is in the page. */
export function holdFocus(veil: HTMLElement, first?: HTMLElement | null) {
  const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  const controls = () => [...veil.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((e) => !e.hasAttribute('disabled') && e.getClientRects().length > 0);
  requestAnimationFrame(() => (first && first.isConnected ? first : controls()[0])?.focus());
  veil.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); veil.remove(); return; }
    if (e.key !== 'Tab') return;
    const list = controls();
    if (!list.length) return;
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); list[list.length - 1].focus(); }
    else if (!e.shiftKey && (i === -1 || i === list.length - 1)) { e.preventDefault(); list[0].focus(); }
  });
  new MutationObserver((_, mo) => {
    if (veil.isConnected) return;
    mo.disconnect();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }).observe(document.body, { childList: true });
}

function tray(): HTMLElement {
  let t = document.getElementById('heralds');
  if (!t) { t = h('div', { id: 'heralds', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  return t;
}

const heralds = new Map<string, { el: HTMLElement; n: number; timer: ReturnType<typeof setTimeout> }>();

export function toast(text: string, kind: Kind = '', ms = 3600, action?: { label: string; run: () => void }) {
  // the same word twice is one herald with a count, not a stack covering the screen
  const key = kind + '|' + text, same = heralds.get(key);
  const retire = (el: HTMLElement) => setTimeout(() => { el.classList.remove('on'); heralds.delete(key); setTimeout(() => el.remove(), 400); }, ms);
  if (same && same.el.isConnected) {
    same.n++; clearTimeout(same.timer); same.timer = retire(same.el);
    let badge = same.el.querySelector('.herald-n');
    if (!badge) { badge = h('b', { class: 'herald-n' }); same.el.prepend(badge); }
    badge.textContent = '×' + same.n;
    return;
  }
  // the words, then the button on its own: read aloud, "…your beast. Defend", never "…your beast.Defend"
  // (a space between flex items takes no room on screen)
  const el = h('div', { class: `herald ${kind}` }, h('span', { class: 'herald-text' }, speak(text)),
    action ? [' ', h('button', { type: 'button', onclick: () => { action.run(); el.remove(); heralds.delete(key); } }, speak(action.label))] : null);
  const t = tray(); t.append(el);
  // keep the tray short: the oldest herald steps aside when a fourth arrives
  while (t.children.length > 3) t.firstElementChild?.remove();
  requestAnimationFrame(() => el.classList.add('on'));
  heralds.set(key, { el, n: 1, timer: retire(el) });
}

/** Ask before a rite. `stay` names the safe answer ("Not now" unless given). With `safeFirst` the safe
 * answer is the bright button and holds the focus, and the rite is the quiet one: for a choice that loses
 * something for good. With `ok` null the box only tells, and the safe answer is the only one. Escape
 * always answers safe (main.ts looks for data-dismiss). */
export function confirmBox(title: string, text: string | string[], ok: string | null = 'Confirm', tone: 'player' | 'enemy' = 'enemy', o: { stay?: string; safeFirst?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (v: boolean) => { veil.remove(); opener?.focus?.({ preventScroll: true }); resolve(v); };
    const opener = document.activeElement as HTMLElement | null;
    const bright = !!o.safeFirst || ok == null;
    const stay = h('button', { type: 'button', class: bright ? 'btn gold' : 'btn ghost', 'data-dismiss': '', onclick: () => done(false) }, speak(o.stay || 'Not now'));
    const go = ok == null ? null : h('button', { type: 'button', class: bright ? 'btn ghost' : `btn ${tone === 'enemy' ? 'ember' : 'gold'}`, onclick: () => done(true) }, speak(ok));
    const veil = h('div', { class: 'veil' },
      h('section', { class: 'scroll oath', role: 'dialog', 'aria-modal': 'true', 'aria-label': speak(title) },
        h('h2', null, speak(title)), ...(Array.isArray(text) ? text : [text]).map((t) => h('p', null, speak(t))),
        h('div', { class: 'row end' }, ...(bright ? [go, stay] : [stay, go]))));
    document.body.append(veil);
    if (bright) stay.focus({ preventScroll: true });
  });
}
