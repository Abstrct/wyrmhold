/* The Sky Atlas: the newest wardens on the ledger, each isle a real planet, drawn around its
 * coven's wellspring. Ride out signs a real MsgFleetMove. */
import { h, clear, toast } from '../core/dom';
import K from '../world/wyrmkit.js';
import { mountScene, type Ctx, type Screen } from './types';
import { topbar, icon, ICON } from '../ui/frame';
import { cursorTip } from '../ui/tip';
import { omenSight, wardens, wardenName, type Sight, type Warden } from '../realm';
import { live } from '../chain/live';
import { guilds, type GuildEntry } from '../guild/directory';
import { empire } from '../game/empire';
import { act } from '../game/actions';
import { wallet } from '../wallet/wallet';
import { covenColor, covenName, retellError, bellsAsTime } from '../lore';
import { markPath } from '../ui/guide';

export function atlas(ctx: Ctx): Screen {
  const canvas = h('canvas');
  const bar = topbar('#/atlas', ctx.oath, { meters: true });
  const search = h('input', { id: 'warden-search', type: 'search', placeholder: 'A warden’s name', autocomplete: 'off' }) as HTMLInputElement;
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Covens' });
  const list = h('ul', { class: 'list scroll-y', 'data-tut': 'atlas' });
  const foot = h('p', { class: 'faint', style: { margin: '0', fontSize: '12px' } });
  const card = h('div');
  const tip = cursorTip(canvas);
  const legend = h('footer', { class: 'glass row', style: { alignSelf: 'center', justifyContent: 'center', gap: '16px', padding: '10px 18px', borderRadius: '999px', fontSize: '13px' } });
  const el = h('div', { class: 'screen' }, h('div', { class: 'stage' }, canvas),
    h('div', { class: 'hud' }, bar.el,
      h('div', { class: 'isle-window', 'aria-hidden': 'true' }),
      h('div', { class: 'cols through' },
        h('aside', { class: 'glass panel col-l', 'aria-label': 'Wardens' },
          h('div', { class: 'field', style: { marginTop: 0 } }, h('label', { for: 'warden-search' }, 'Find a warden'), search), chips, list, foot),
        card),
      legend));

  let all: Warden[] = [];
  let covens: string[] = [];
  let meta = new Map<string, GuildEntry>();
  let coven: string | null = null;
  let richOnly = false;
  let sight = new Map<string, Sight>();
  let sightOk = false;
  let failed = false;
  let again = () => {};
  const oreOf = (w: Warden) => sight.get(w.id)?.ore ?? 0;
  const sleptFor = (w: Warden) => { const l = sight.get(w.id)?.lastAction ?? 0; return l && live.height ? live.height - l : 0; };
  let sel = -1;
  let scene: ReturnType<typeof mountScene<{ dispose(): void; select(i: number | null): void; ride(i: number): void; glowRich(o: number[]): void }>> | null = null;

  const name = (id: string) => covenName(id, meta.get(id)?.meta?.name);

  function pick(i: number | null) {
    sel = i ?? -1; scene?.get()?.select(i); paint();
    // on a phone the chosen isle's card sits below the list: bring it up
    if (i != null && matchMedia('(max-width: 720px)').matches) requestAnimationFrame(() => card.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function paint() {
    const q = search.value.trim().toLowerCase();
    clear(chips);
    chips.append(h('button', { type: 'button', class: 'chip' + (richOnly ? ' on' : ''), 'aria-pressed': String(richOnly), 'data-tut': 'rich', onclick: () => { richOnly = !richOnly; if (richOnly) markPath('atlas'); paint(); } },
      h('span', { class: 'gem', style: { background: 'var(--root)', width: '8px', height: '8px' } }), 'Unbrewed wildroot', h('span', { class: 'n' }, String(all.filter((w) => oreOf(w) > 0 && w.id !== empire.commander?.playerId).length))));
    for (const c of covens) chips.append(h('button', { type: 'button', class: 'chip' + (coven === c ? ' on' : ''), 'aria-pressed': String(coven === c), onclick: () => { coven = coven === c ? null : c; paint(); } },
      h('span', { class: 'gem', style: { background: covenColor(c), width: '8px', height: '8px' } }), name(c)));
    clear(list);
    let shown = all.map((w, i) => ({ w, i })).filter(({ w }) => (!coven || w.guildId === coven) && (!richOnly || (oreOf(w) > 0 && w.id !== empire.commander?.playerId)) && (!q || wardenName(w).toLowerCase().includes(q) || w.id.includes(q) || w.planetId.includes(q)));
    if (richOnly) shown = shown.sort((a, b) => oreOf(b.w) - oreOf(a.w));
    // your own hold always leads the list, so home is never lost among hundreds
    else { const me = empire.commander?.playerId; const k = shown.findIndex(({ w }) => w.id === me); if (k > 0) shown.unshift(...shown.splice(k, 1)); }
    for (const { w, i } of shown.slice(0, 300)) {
      const you = w.id === empire.commander?.playerId;
      list.append(h('li', null, h('button', { type: 'button', class: 'item' + (sel === i ? ' on' : ''), style: { minHeight: '46px' }, onclick: () => pick(i) },
        h('span', { class: 'l' }, h('span', { class: 'gem', style: { background: you ? '#fff1c4' : covenColor(w.guildId), boxShadow: `0 0 8px ${covenColor(w.guildId)}` } }), h('span', { class: 'nm', style: { fontSize: '15px' } }, you ? 'Your Hold' : wardenName(w))),
        oreOf(w) > 0 && !you ? h('span', { style: { fontSize: '12.5px', color: 'var(--root)' } }, `${oreOf(w)} wildroot`)
          : you ? ''
            : sleptFor(w) > 600 ? h('span', { class: 'faint', style: { fontSize: '12.5px' }, title: 'Not stirred for a long while: unlikely to defend' }, 'asleep') : ''),
      ));
    }
    // the sky could not be read: say so plainly (and keep saying it), with a way to ask again
    if (failed && !all.length) { clear(foot); foot.append('The ledger is not answering just now. ', h('button', { type: 'button', class: 'linkish', onclick: () => again() }, 'Try again')); }
    else foot.textContent = all.length ? `${shown.length} of ${all.length} wardens · newest on the ledger` : 'Reading the ledger…';
    clear(card);
    const w = all[sel];
    if (w) {
      const me = empire.commander;
      const you = w.id === me?.playerId;
      card.append(h('section', { class: 'glass panel rise', 'aria-label': 'Chosen isle', style: { flex: '0 1 360px', minWidth: '280px', padding: '20px' } },
        h('p', { class: 'eyebrow row', style: { color: covenColor(w.guildId), gap: '8px' } }, h('span', { class: 'gem', style: { background: covenColor(w.guildId), width: '8px', height: '8px' } }), name(w.guildId)),
        h('h1', { class: 'display', style: { fontSize: '36px', marginTop: '6px', overflowWrap: 'anywhere' } }, you ? 'Your Hold' : wardenName(w)),
        h('dl', { class: 'facts' },
          h('div', null, h('dt', null, 'Coven'), h('dd', null, w.guildId ? name(w.guildId) : 'none')),
          you ? null : h('div', null, h('dt', null, 'Last stirred'), h('dd', null, sleptFor(w) ? (sleptFor(w) > 14400 ? 'long asleep: unlikely to defend' : `${bellsAsTime(sleptFor(w))} ago`) : '—')),
          h('div', { style: { gridColumn: 'span 2' } }, h('dt', null, you ? 'Unbrewed wildroot (raiders could take it)' : 'Wildroot to plunder'), h('dd', { style: { color: oreOf(w) > 0 ? 'var(--root)' : undefined } }, oreOf(w) > 0 ? `${oreOf(w)} ${oreOf(w) === 1 ? 'sheaf' : 'sheaves'}` : 'none — nothing to take'))),
        h('details', { class: 'more' }, h('summary', null, 'Ledger marks'),
          h('dl', { class: 'facts' },
            h('div', null, h('dt', null, 'Warden'), h('dd', { class: 'mono' }, w.id)),
            h('div', null, h('dt', null, 'Isle'), h('dd', { class: 'mono' }, w.planetId)),
            h('div', null, h('dt', null, 'Coven'), h('dd', { class: 'mono' }, w.guildId || '—')),
            h('div', null, h('dt', null, 'Warband'), h('dd', { class: 'mono' }, w.fleetId || '—')))),
        h('p', { style: { margin: '14px 0 0', fontSize: '15px', color: '#cfc5dd' } }, you ? 'Your own isle, drifting where the old sky set it.' : 'Somewhere on that shard a warden sleeps, or schemes. To you it floats here, a ride from your hold.'),
        // One road to a raid: the Skirmish walks it step by step (ride out, strike, plunder).
        you ? h('a', { class: 'btn gold block', href: '#/hold', style: { marginTop: '16px', minHeight: '54px' } }, 'Go to your Hold')
          : h('a', { class: 'btn ember block', href: `#/skirmish/${w.id}`, 'data-tut': 'ride', style: { marginTop: '16px', minHeight: '54px', fontSize: '17px' } }, 'Raid this hold', icon(ICON.arrow, 18)),
        // a raid on an empty hold only breaks things: say so before the ride
        !you && sightOk && oreOf(w) === 0 ? h('p', { class: 'faint', style: { margin: '6px 0 0', fontSize: '13px' } }, 'Nothing unbrewed to plunder there right now. Amber isles hold a prize.') : '',
        you ? '' : h('div', { class: 'row', style: { marginTop: '8px', gap: '8px' } },
          h('a', { class: 'btn small', href: `#/hold/${w.id}`, style: { flex: '1' } }, 'Scry their isle'),
          h('button', { type: 'button', class: 'btn small', style: { flex: '1' }, onclick: () => rideOut(w) }, 'Just ride there')),
        h('button', { type: 'button', class: 'btn ghost block', style: { marginTop: '10px' }, onclick: () => pick(null) }, 'Back to the whole sky')));
    }
    clear(legend);
    for (const c of covens) legend.append(h('span', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'gem', style: { background: covenColor(c) } }), name(c)));
  }

  function rideOut(w: Warden) {
    const p = empire.commander;
    if (!p) { toast('Swear the oath first: you have no warband to ride.', 'warn', 5000, { label: 'Oath', run: ctx.oath }); return; }
    if (!wallet.unlocked) { toast('Your soulstone is sealed.', 'warn', 5000, { label: 'Unseal', run: ctx.oath }); return; }
    try {
      act.fleetMove(p, w.planetId);
      scene?.get()?.ride(sel);
      toast(`Your warband rides for isle ${w.planetId}. When it lands, the plunder chant can begin.`, 'player', 6000, { label: 'To war', run: () => ctx.go(`#/skirmish/${w.id}`) });
    } catch (e) { toast(retellError((e as Error).message), 'enemy'); }
  }

  search.addEventListener('input', paint);
  // read the sky; if the ledger is down, say so and keep asking quietly until it answers
  let left = false, retry = 0, gen = 0;
  const read = () => { const g = ++gen; return Promise.all([wardens(), guilds().catch(() => [] as GuildEntry[]), omenSight().catch(() => null)]).then(([ws, gs, sg]) => {
    // only the newest read counts, and the sky is built once
    if (left || g !== gen || scene) return;
    clearTimeout(retry);
    failed = false;
    // without sight of the isles' stores we cannot say an isle is empty: keep quiet rather than mislead
    sightOk = !!sg;
    sight = sg || new Map<string, Sight>();
    meta = new Map(gs.map((g) => [g.id, g]));
    all = ws.slice();
    addMe();
    buildSky(ctx.param || null);
  }, () => { if (left || g !== gen || scene) return; failed = true; paint(); clearTimeout(retry); retry = window.setTimeout(read, 8000); }); };
  /** Your own isle belongs in the sky even when the ledger's newest-first page left it out. */
  function addMe(): boolean {
    const me = empire.commander;
    if (!me || !me.planetId || all.some((w) => w.id === me.playerId)) return false;
    all.unshift({ id: me.playerId, name: me.name, guildId: me.guildId, planetId: me.planetId, fleetId: me.fleetId, address: me.address });
    return true;
  }
  /** Build the 3D sky from `all`, choosing the warden `focus` (by id) once it stands. */
  function buildSky(focus: string | null) {
    covens = [...new Set(all.map((w) => w.guildId).filter(Boolean))].sort();
    const colors: Record<string, number> = {};
    for (const c of covens) colors[c] = parseInt(covenColor(c).slice(1), 16);
    const meId = empire.commander?.playerId;
    scene = mountScene(canvas, (c) => K.atlas(c, {
      covens, colors, isles: all.map((w) => ({ id: w.id, coven: w.guildId, you: w.id === meId })), onPick: (i: number) => pick(i),
      onHover: (i: number | null) => {
        const w = i == null ? undefined : all[i], you = w?.id === empire.commander?.playerId;
        tip.show(w ? (you ? 'Your Hold' : wardenName(w)) : null, w && !you && oreOf(w) > 0 ? `${oreOf(w)} wildroot to plunder` : 'click to look closer');
      },
    }), (c) => { c.glowRich(all.map((w) => oreOf(w))); if (focus) { const i = all.findIndex((w) => w.id === focus); if (i >= 0) pick(i); } });
    paint();
  }
  again = () => { clearTimeout(retry); foot.textContent = 'Asking the ledger again…'; void read(); };
  void read();
  paint();
  // when your own warden is read after the sky, the list learns which hold is yours (and pins it)
  let knownMe = empire.commander?.playerId;
  const offMe = empire.onChange(() => {
    const id = empire.commander?.playerId;
    if (id === knownMe || left) return;
    knownMe = id;
    if (!all.length) return;
    // the sky marks (and rides from) your own isle, so it is built again for the warden now known,
    // adding their isle if the ledger's page left it out, and keeping what was chosen
    if (scene) {
      const added = addMe();
      const was = sel >= 0 ? all[sel + (added ? 1 : 0)]?.id ?? null : null;
      tip.show(null); // the old sky's hover never says goodbye
      scene.dispose(); scene = null; sel = -1; buildSky(was);
    } else paint();
  });
  return { el, title: 'Sky Atlas', leave: () => { left = true; offMe(); clearTimeout(retry); scene?.dispose(); tip.dispose(); bar.dispose(); } };
}
