/* The Prologue: the first thing a new warden sees. The camera lifts, alpha falls like rain, and
 * the tale is told a line at a time — then the sky asks a question. Shown once; the Grimoire and
 * the Gate can tell it again. Any key, click or tap moves it on; Escape lets it go. */
import { h } from '../core/dom';
import { audio, ambience } from '../core/audio';

const KEY = 'wyrmhold.prologue';
export const prologueSeen = () => { try { return localStorage.getItem(KEY) === 'seen'; } catch { return false; } };

const BEATS: { text: string; small?: string; rain?: boolean }[] = [
  { text: 'Before the bells, there was one sky.', small: 'and it was whole' },
  { text: 'Then it broke.', small: 'no song remembers why' },
  { text: 'Its shards fell upward into the dark, and stayed there — drifting above the clouds.' },
  { text: 'And from the wound came alpha.', small: 'the first light', rain: true },
  { text: 'Where it touched stone, springs woke. Where it touched soil, wildroot grew strange and deep.', rain: true },
  { text: 'Where it touched the old beasts sleeping in the clouds…', small: '…they opened their eyes.', rain: true },
  { text: 'Every shard is held now. Every holder is hungry.', small: 'and alpha, once brewed, can never be taken', rain: true },
];

/** Play the prologue over the Gate. `rain` drives the scene's alpha rain. */
export function playPrologue(opts: { rain?: (on: boolean) => void; onOath: () => void }) {
  let i = -1, timer = 0, closed = false;
  const line = h('p', { class: 'pro-line' });
  const small = h('p', { class: 'pro-small' });
  const dots = h('div', { class: 'pro-dots', 'aria-hidden': 'true' }, ...BEATS.map(() => h('i')));
  const choice = h('div', { class: 'pro-choice' });
  const skip = h('button', { type: 'button', class: 'btn small ghost pro-skip', onclick: () => finish() }, 'Skip the tale');
  const veil = h('div', { class: 'prologue', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'The Prologue', tabindex: '-1' },
    h('div', { class: 'pro-center', 'aria-live': 'polite' }, line, small, choice), dots, h('p', { class: 'pro-hint' }, 'Click or press space to go on'), skip);
  document.body.append(veil);
  document.body.classList.add('in-prologue');
  veil.focus();
  ambience.start();

  function show(n: number) {
    i = n;
    clearTimeout(timer);
    if (n >= BEATS.length) return ask();
    const b = BEATS[n];
    veil.classList.remove('beat-in'); void veil.offsetWidth; veil.classList.add('beat-in');
    line.textContent = b.text; small.textContent = b.small || '';
    [...dots.children].forEach((d, k) => d.classList.toggle('on', k <= n));
    veil.classList.toggle('hinted', n >= 2);
    opts.rain?.(!!b.rain);
    if (n === 1) audio.bell(146.83, 0.25, 4);
    if (n === 3) { audio.bell(659.25, 0.12, 3); setTimeout(() => audio.bell(987.77, 0.08, 3), 260); }
    timer = window.setTimeout(() => show(n + 1), 4200 + b.text.length * 22);
  }
  function ask() {
    veil.classList.remove('beat-in'); void veil.offsetWidth; veil.classList.add('beat-in', 'asking');
    line.textContent = 'Will you hold a shard of it?';
    small.textContent = '';
    skip.remove();
    // the question lands first; the answers rise once it has been read
    choice.classList.add('later');
    choice.append(
      h('button', { type: 'button', class: 'btn gold', style: { minHeight: '52px', padding: '0 26px', fontSize: '18px' }, onclick: () => { finish(); opts.onOath(); } }, 'Yes: bind my soulstone'),
      h('button', { type: 'button', class: 'btn', style: { minHeight: '52px', padding: '0 22px', fontSize: '17px' }, onclick: () => finish() }, 'Look around first'));
    setTimeout(() => (choice.firstChild as HTMLElement)?.focus(), 1500);
  }
  function finish() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    try { localStorage.setItem(KEY, 'seen'); } catch { /* memory only */ }
    opts.rain?.(true);
    setTimeout(() => opts.rain?.(false), 5000);
    veil.classList.add('gone');
    document.body.classList.remove('in-prologue');
    document.removeEventListener('keydown', key);
    setTimeout(() => veil.remove(), 900);
  }
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { finish(); return; }
    if (i < BEATS.length && (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight')) { e.preventDefault(); show(i + 1); }
  };
  document.addEventListener('keydown', key);
  veil.addEventListener('click', (e) => { if (e.target === skip || choice.contains(e.target as Node)) return; if (i < BEATS.length) show(i + 1); });
  const start = setTimeout(() => show(0), 700);
  return { close: () => { clearTimeout(start); finish(); } };
}
