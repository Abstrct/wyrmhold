/* Incantations (the proof-of-work engine's tasks) and the Chronicle (the transaction queue),
 * told in the realm's words. Both are live views over the borrowed ledger modules. */
import { h, clear } from '../core/dom';
import { pow, type PowTask } from '../pow/pow';
import { txq, type TxJob } from '../wallet/queue';
import { live } from '../chain/live';
import { retell, retellError, bellsAsTime, agoMs } from '../lore';
import { canRetry } from '../game/actions';

const KIND: Record<PowTask['kind'], [string, string]> = {
  build: ['Summoning chant', 'var(--gold)'], mine: ['Delving chant', 'var(--root)'], refine: ['Brewing chant', '#7dffb0'], raid: ['Plunder chant', 'var(--ember)'],
};

function fmtRate(r: number) { return r >= 1e9 ? `${(r / 1e9).toFixed(1)} G` : r >= 1e6 ? `${(r / 1e6).toFixed(1)} M` : r >= 1e3 ? `${(r / 1e3).toFixed(0)} k` : `${Math.round(r)}`; }

export function chantsPanel() {
  const list = h('ul', { class: 'list', style: { gap: '12px' } });
  const meta = h('span', { class: 'mono faint', style: { fontSize: '11px' } });
  const el = h('section', { class: 'glass panel', 'aria-label': 'Incantations' },
    h('div', { class: 'row between', style: { marginBottom: '10px' } }, h('h2', { class: 'display', style: { fontSize: '19px' } }, 'Incantations'), meta), list,
    // chants are sung by this browser: a warden who closes it should know they pause
    h('p', { class: 'faint', style: { margin: '10px 0 0', fontSize: '12px' } }, 'Sung by this browser while Wyrmhold is open.'));
  const paint = () => {
    clear(list);
    const tasks = pow.active.filter((t) => t.account >= 0);
    // the rate is for the curious; the warden only needs to know the Hold is singing
    meta.textContent = pow.rate ? 'singing…' : '';
    meta.title = pow.rate ? `${fmtRate(pow.rate)} chants a second, on this computer` : '';
    // An empty panel only explains itself: it shows once a chant is sounding.
    el.hidden = !tasks.length;
    if (!tasks.length) return;
    for (const t of tasks) {
      const [name, color] = KIND[t.kind];
      const need = pow.required(t), best = t.best?.zeros ?? 0;
      const pct = Math.max(4, Math.min(100, (best / Math.max(1, need)) * 100));
      const wait = need > best ? pow.blocksUntil(t, best) : 0;
      const note = t.status === 'submitting' ? 'spoken to the ledger…'
        : t.waits ? `waits: ${t.waits}. Fell it and the plunder lands`
        : best >= need ? 'ready'
          // by then the chant already sung is enough; a lucky one can land sooner
          : Number.isFinite(wait) && wait > 0 ? `done within ~${bellsAsTime(wait)}, sooner with luck` : t.status === 'hashing' ? 'chanting…' : 'waiting';
      list.append(h('li', { class: 'chant' },
        h('div', { class: 'top' }, h('span', null, name, h('span', { class: 'faint' }, ' · ' + retell(t.label).replace(/^[^·]*chant · /i, '').replace(/ · chant of \d+$/, ''))), h('span', { class: 'mono faint', style: { fontSize: '12px' }, title: `Chant strength ${best} of ${need} needed` }, `${Math.round(Math.min(100, (best / Math.max(1, need)) * 100))}%`)),
        h('span', { class: 'bar' }, h('i', { style: { width: pct + '%', background: color } })),
        h('span', { class: 'faint', style: { fontSize: '12px' } }, note + (t.error ? ` · ${retellError(t.error).replace(/\bunder_raid\b/, 'raiders overhead')}` : ''))));
    }
  };
  const offs = [pow.onChange(paint), live.onBlock(paint)];
  paint();
  return { el, dispose: () => offs.forEach((f) => f()) };
}

const STATUS: Record<TxJob['status'], [string, string]> = {
  queued: ['awaits', 'var(--muted)'], waiting: ['gathers breath', 'var(--verdigris)'], signing: ['is sealed', 'var(--gold)'], pending: ['is spoken', 'var(--gold)'],
  success: ['is done', '#7dffb0'], failed: ['failed', 'var(--ember)'], cancelled: ['was let go', 'var(--faint)'],
};

export function chroniclePanel(filter: (j: TxJob) => boolean = () => true, max = 30) {
  const list = h('ol', { class: 'list chron scroll-y', style: { gap: '6px', maxHeight: '170px' } });
  const el = h('section', { class: 'glass panel', 'aria-label': 'Chronicle', style: { display: 'flex', flexDirection: 'column' } },
    h('h2', { class: 'display', style: { fontSize: '19px', marginBottom: '8px' } }, 'Chronicle'), list);
  let last: TxJob[] = [];
  const paint = (jobs: TxJob[]) => {
    last = jobs;
    clear(list);
    // the same rite done again and again reads as one line with a count; so does the same refusal,
    // however the rows between fell (eight taps on a full sky are one line, ×8, newest first)
    const sorted = jobs.filter(filter).slice().sort((a, b) => b.updatedAt - a.updatedAt);
    const shown: TxJob[] = [], times = new Map<TxJob, number>();
    const keys = new Map<TxJob, string>();
    const said = (j: TxJob) => { let k = keys.get(j); if (k == null) { k = j.label.replace(/ · chant of \d+$/, '') + (j.status === 'failed' ? '|' + retellError(j.error || '') : ''); keys.set(j, k); } return k; };
    for (const j of sorted) {
      const prev = shown[shown.length - 1];
      const same = j.status === 'failed' ? shown.find((s) => s.status === 'failed' && said(s) === said(j))
        : prev && prev.status === 'success' && j.status === 'success' && said(prev) === said(j) ? prev : undefined;
      if (same) { times.set(same, (times.get(same) || 1) + 1); continue; }
      if (shown.length >= max) break;
      shown.push(j);
    }
    // Like the chants: an empty chronicle waits out of sight until there is something to tell.
    el.hidden = !shown.length;
    if (!shown.length) return;
    for (const j of shown) {
      const [word, color] = STATUS[j.status];
      list.append(h('li', null,
        h('span', { class: 'when', title: (j.height ? `Bell ${j.height} · ` : '') + new Date(j.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }, agoMs(j.updatedAt)),
        h('span', null, h('span', null, retell(j.label).replace(/ · chant of \d+$/, '')), ' ', h('span', { style: { color } }, word), times.get(j) ? h('span', { class: 'herald-n', style: { marginLeft: '6px' } }, `×${times.get(j)}`) : null,
          j.status === 'waiting' && j.waitReason ? h('span', { class: 'faint' }, ` — ${retellError(j.waitReason)}`) : null,
          j.status === 'failed' && j.error ? h('span', { style: { color: 'var(--ember-ink)' } }, ` — ${retellError(j.error)}`) : null,
          // a stale refusal is only told: sent again blind, it could ride a new Wyrm to a plundered isle
          j.status === 'failed' && canRetry(j) ? [' ', h('button', { type: 'button', class: 'btn small ghost', style: { marginLeft: '6px', minHeight: '28px' }, 'aria-label': `Again: ${retell(j.label).replace(/ · chant of \d+$/, '')}`, onclick: () => { if (canRetry(j)) txq.retry(j.id); else paint(last); } }, 'Again')] : null)));
    }
  };
  const off = txq.onChange(paint);
  // "just now" ages: refresh the times twice a minute
  const tick = setInterval(() => paint(last), 30_000);
  // repaint: the filter's answer changed without the queue changing (whose rites these are)
  return { el, repaint: () => paint(last), dispose: () => { off(); clearInterval(tick); } };
}
