/* A first look around the Hold: a light on each thing a new warden must find (the warband, the
 * meters, the rites, help, the guide). Shown once per browser; any key or click outside
 * the card moves on, Escape ends it. */
import { h } from '../core/dom';

const KEY = 'wyrmhold.tour.hold';
const seen = () => { try { return localStorage.getItem(KEY) === 'seen'; } catch { return true; } };

interface Stop { sel: string; title: string; text: string }
const STOPS: Stop[] = [
  { sel: '.roster-panel', title: 'Bound to you', text: 'Every beast and hallow you hold. Tap one, here or on the isle itself, to see what it can do.' },
  { sel: '.topbar .meters', title: 'Your meters', text: 'Treasure, mana, breath and ward. Tap any of them to learn what it means and how to get more.' },
  { sel: 'nav.rites', title: 'Rites', text: 'The big moves: summon, ride out, raid. A greyed rite tells you why it has to wait.' },
  { sel: '.help-btn', title: 'Help, any time', text: 'Lost? Press ? for how to play, in four moves, and the words worth knowing.' },
  { sel: '.path', title: 'Ysolde, your guide', text: 'She always knows the next step. Tap her to hear it, then “Show me” lights the right button.' },
];

let running = false;

export function holdTour() {
  if (running || seen()) return;
  const stops = STOPS.filter((s) => document.querySelector(s.sel));
  if (!stops.length) return;
  running = true;
  let i = 0;
  const hole = h('div', { class: 'tour-hole', 'aria-hidden': 'true' });
  const step = h('p', { class: 'tour-n' });
  const title = h('h3', { class: 'display' });
  const text = h('p', { class: 'tour-text' });
  const next = h('button', { type: 'button', class: 'btn gold small', onclick: () => go(i + 1) });
  const card = h('div', { class: 'tour-card glass', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'A first look around' },
    step, title, text,
    h('div', { class: 'row between', style: { marginTop: '12px' } },
      h('button', { type: 'button', class: 'btn ghost small', onclick: () => end() }, 'Skip'), next));
  const veil = h('div', { class: 'tour', onclick: (e: Event) => { if (!card.contains(e.target as Node)) go(i + 1); } }, hole, card);
  document.body.append(veil);
  // the first look speaks alone: the Hold's notices and hints wait until it is done
  document.body.classList.add('touring');

  function place() {
    const el = document.querySelector(stops[i].sel) as HTMLElement | null;
    if (!el) { go(i + 1); return; }
    const r = el.getBoundingClientRect(), pad = 8;
    Object.assign(hole.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    const cw = Math.min(320, window.innerWidth - 24), ch = card.offsetHeight || 170;
    // beside the light if there is room, else above or below it
    let x = r.right + 20, y = r.top;
    if (x + cw > window.innerWidth - 12) x = r.left - cw - 20;
    if (x < 12) { x = Math.max(12, Math.min(window.innerWidth - cw - 12, r.left + r.width / 2 - cw / 2)); y = r.bottom + 16 + ch > window.innerHeight ? r.top - ch - 16 : r.bottom + 16; }
    Object.assign(card.style, { left: `${x}px`, top: `${Math.max(12, Math.min(window.innerHeight - ch - 12, y))}px`, width: `${cw}px` });
  }
  function go(n: number) {
    if (n >= stops.length) { end(); return; }
    i = n;
    const s = stops[i];
    step.textContent = `A first look · ${i + 1} of ${stops.length}`;
    title.textContent = s.title;
    text.textContent = s.text;
    next.textContent = i === stops.length - 1 ? 'Got it' : 'Next';
    (document.querySelector(s.sel) as HTMLElement | null)?.scrollIntoView?.({ block: 'center', behavior: 'instant' as ScrollBehavior });
    requestAnimationFrame(place);
    next.focus();
  }
  function end() {
    try { localStorage.setItem(KEY, 'seen'); } catch { /* once per visit then */ }
    veil.remove(); running = false; document.body.classList.remove('touring');
    window.removeEventListener('resize', place); document.removeEventListener('keydown', key, true); window.removeEventListener('hashchange', end);
  }
  const key = (e: KeyboardEvent) => {
    // a dialog opened over the tour keeps its own keys
    if (document.querySelector('.veil')) return;
    if (e.key === 'Escape') { e.stopPropagation(); end(); }
    else if (e.key === 'ArrowRight') go(i + 1);
    else if (e.key === 'ArrowLeft' && i > 0) go(i - 1);
  };
  window.addEventListener('resize', place);
  document.addEventListener('keydown', key, true);
  window.addEventListener('hashchange', end);
  go(0);
}

/** For the Grimoire: show the tour again next time the Hold opens. */
export function resetTour() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
