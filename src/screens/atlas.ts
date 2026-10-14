/* The Sky Atlas: the newest wardens on the ledger, each isle a real planet, drawn around its
 * coven's wellspring. Ride out signs a real MsgFleetMove. */
import { h, clear, toast, keepFocus } from '../core/dom';
import K from '../world/wyrmkit.js';
import { mountScene, type Ctx, type Screen } from './types';
import { topbar, icon, ICON } from '../ui/frame';
import { cursorTip } from '../ui/tip';
import { omenSight, onSight, skyFull, wardens, wardenName, type Sight, type Warden } from '../realm';
import { live } from '../chain/live';
import { guilds, type GuildEntry } from '../guild/directory';
import { empire } from '../game/empire';
import { act } from '../game/actions';
import { wallet } from '../wallet/wallet';
import { covenColor, covenName, retellError, bellsAsTime, beastName } from '../lore';
import { markPath } from '../ui/guide';
import { hearts } from '../ui/frame';
import { alive, guardsOf, inRealm, reach, wyrmOf } from '../game/war';
import { worldView, openSky, keepFramed, PHONE_UPRIGHT, PHONE_SIDEWAYS } from '../ui/world';

export function atlas(ctx: Ctx): Screen {
  const canvas = h('canvas');
  // "look at the world": the panels tuck away; once the eye has flown to an isle, a way back to the whole sky
  const world = worldView('atlas', { home: () => scene?.get()?.home(), homeLabel: 'Whole sky' });
  const bar = topbar('/atlas', ctx.oath, { meters: true, world: world.el });
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
  let scene: ReturnType<typeof mountScene<{ dispose(): void; select(i: number | null): void; ride(i: number): void; glowRich(o: number[]): void; frame(dx: number, dy: number, fit?: number): void; home(): void }>> | null = null;
  /** Keep the chosen isle in the open sky between the list and its card (on a phone, in the window above them). */
  function reframe() {
    const ctl = scene?.get();
    if (!ctl || !canvas.isConnected) return;
    const wardensBox = el.querySelector('[aria-label="Wardens"]');
    const g = openSky(canvas, {
      window: matchMedia(PHONE_UPRIGHT).matches ? el.querySelector('.isle-window') : null,
      tops: [bar.el], bottoms: [legend],
      sides: matchMedia(PHONE_SIDEWAYS).matches ? [wardensBox, card, legend] : [wardensBox, card],
    });
    if (g) ctl.frame(g.dx, g.dy);
  }
  const framer = keepFramed(reframe);
  const offWorld = world.onChange(() => framer.soon());

  const name = (id: string) => covenName(id, meta.get(id)?.meta?.name);

  /** The warden being scouted: read from the ledger while their isle is chosen, so the card can say how their hold stands. */
  let scouted: string | null = null;
  function scout(id: string | null) {
    if (id === scouted) return;
    if (scouted) empire.unwatch(scouted);
    scouted = id;
    if (id) empire.watch(id);
  }
  // GRASS keeps the sight current while the Atlas is open: a warden digs, brews or is plundered and their isle glows or dims
  const offSight = onSight(() => { if (left || !scene) return; paint(); scene.get()?.glowRich(all.map((w) => oreOf(w))); });
  const offScout = empire.onChange(() => { if (scouted && sel >= 0 && all[sel]?.id === scouted) paint(); });

  const andList = (xs: string[]) => (xs.length > 1 ? xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1] : xs[0] || '');
  /** How their hold stands before you ride: their Wyrm, its guards, who rides at home, and which of yours can reach it. */
  function scoutBlock(pid: string) {
    const f = empire.players.get(pid), me = empire.commander;
    if (!f) return h('div', { class: 'scout' }, h('p', { class: 'faint', style: { margin: 0, fontSize: '13px' } }, 'Scrying their hold…'));
    const w = wyrmOf(f), home = f.fleet?.status !== 'away';
    const guards = w ? guardsOf(w, f) : [];
    const riders = [...f.structs.values()].filter((s) => alive(s) && s.type!.category === 'fleet' && s.typeId !== 1).length;
    const state = !w || !alive(w) ? 'fallen' : !home ? 'abroad' : !w.online ? 'slumbering' : 'home';
    const verdict = state === 'fallen' ? 'Their Elder Wyrm has fallen: their ward is open. The plunder can land as soon as you hold their sky.'
      : state === 'abroad' ? 'Their warband is abroad with their Wyrm: their ward is open, and nothing at home can strike you.'
      : state === 'slumbering' ? 'Their Elder Wyrm slumbers: their ward is open while it sleeps.'
      : guards.length ? `To win: fell their ${andList(guards.map((g) => beastName(g.typeId)))}, then their Elder Wyrm.`
      : 'To win: fell their Elder Wyrm. Nothing guards it.';
    // which of our beasts could strike their Wyrm where it hangs
    const mine = me ? [...me.structs.values()].filter((s) => alive(s) && s.online && s.type!.category === 'fleet') : [];
    const reachers = w && alive(w) && home ? mine.filter((a) => reach(a, w).weapon) : [];
    const full = skyFull(f.planet, me);
    const soar = w && alive(w) && home && !reachers.length ? mine.find((a) => reach(a, w).soar) : undefined;
    return h('div', { class: 'scout', role: 'group', 'aria-label': 'Scouting' },
      h('p', { class: 'scout-k' }, 'Scouting'),
      w && alive(w) ? h('p', { class: 'scout-row' }, h('span', null, 'Their Elder Wyrm'), h('span', { class: 'hearts', role: 'img', 'aria-label': `vigor ${w.health} of ${w.type!.maxHealth}` }, hearts(w.health, w.type!.maxHealth)), h('span', { class: 'faint' }, state === 'home' ? `at home, in ${inRealm(w.ambit)}` : state)) : null,
      guards.length ? h('p', { class: 'scout-row' }, h('span', null, 'Guarded by'), h('span', { style: { color: '#ddd0ff' } }, guards.map((g) => beastName(g.typeId)).join(', '))) : null,
      home ? h('p', { class: 'scout-row' }, h('span', null, 'At home'), h('span', null, `${riders || 'no'} ${riders === 1 ? 'beast' : 'beasts'}${state === 'fallen' ? '' : ' besides the Wyrm'}`)) : null,
      h('p', { class: 'scout-verdict' }, verdict),
      me && w && alive(w) && home ? h('p', { class: 'scout-reach' }, reachers.length ? `Your ${andList(reachers.map((a) => beastName(a.typeId)))} can reach their Wyrm.` : soar ? `None of your beasts reach their Wyrm in ${inRealm(w.ambit)} yet; your Elder Wyrm can soar there.` : `None of your beasts can reach their Wyrm in ${inRealm(w.ambit)}.`) : null,
      // their sky holds one raider at a time: say so before the ride, not after the ledger refuses it
      full ? h('p', { class: 'scout-reach', style: { color: 'var(--ember-ink)' } }, full) : null);
  }

  function pick(i: number | null) {
    sel = i ?? -1; scene?.get()?.select(i); paint();
    // on a phone the chosen isle's card sits below the list: bring it up
    if (i != null && matchMedia('(max-width: 720px)').matches) requestAnimationFrame(() => card.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  // the panels rebuild as the ledger moves (the scouted warden is read again and again):
  // each section repaints only when what it says has changed, and keyboard focus survives it
  const sigs: Record<string, string> = {};
  /** One section repaints only when what it says has changed. */
  const changed = (k: string, sig: string) => { if (sigs[k] === sig) return false; sigs[k] = sig; return true; };
  /** Which wardens' "Ledger marks" were left open, so a rebuilt card keeps them open. */
  const marksOpen = new Set<string>();
  let facts: HTMLElement | null = null, scoutBox: HTMLElement | null = null, cardFor: string | null = null;

  function paint() { keepFocus(el, paintNow); framer.soon(); }
  function paintNow() {
    const q = search.value.trim().toLowerCase();
    const meId = empire.commander?.playerId;
    const rich = all.filter((w) => oreOf(w) > 0 && w.id !== meId).length;
    if (changed('chips', JSON.stringify([richOnly, coven, rich, covens.map((c) => [c, name(c)])]))) {
      clear(chips);
      chips.append(h('button', { type: 'button', class: 'chip' + (richOnly ? ' on' : ''), 'aria-pressed': String(richOnly), 'data-tut': 'rich', 'data-key': 'rich', onclick: () => { richOnly = !richOnly; if (richOnly) markPath('atlas'); paint(); } },
        h('span', { class: 'gem', style: { background: 'var(--root)', width: '8px', height: '8px' } }), 'Unbrewed wildroot', h('span', { class: 'n' }, String(rich))));
      for (const c of covens) chips.append(h('button', { type: 'button', class: 'chip' + (coven === c ? ' on' : ''), 'aria-pressed': String(coven === c), 'data-key': 'coven:' + c, onclick: () => { coven = coven === c ? null : c; paint(); } },
        h('span', { class: 'gem', style: { background: covenColor(c), width: '8px', height: '8px' } }), name(c)));
    }
    let shown = all.map((w, i) => ({ w, i })).filter(({ w }) => (!coven || w.guildId === coven) && (!richOnly || (oreOf(w) > 0 && w.id !== meId)) && (!q || wardenName(w).toLowerCase().includes(q) || w.id.includes(q) || w.planetId.includes(q)));
    if (richOnly) shown = shown.sort((a, b) => oreOf(b.w) - oreOf(a.w));
    // your own hold always leads the list, so home is never lost among hundreds
    else { const k = shown.findIndex(({ w }) => w.id === meId); if (k > 0) shown.unshift(...shown.splice(k, 1)); }
    const rows = shown.slice(0, 300);
    if (changed('list', JSON.stringify([meId, rows.map(({ w, i }) => [i, oreOf(w), sleptFor(w) > 600])]))) {
      clear(list);
      for (const { w, i } of rows) {
        const you = w.id === meId;
        list.append(h('li', null, h('button', { type: 'button', class: 'item', 'data-key': w.id, style: { minHeight: '46px' }, onclick: () => pick(i) },
          h('span', { class: 'l' }, h('span', { class: 'gem', style: { background: you ? '#fff1c4' : covenColor(w.guildId), boxShadow: `0 0 8px ${covenColor(w.guildId)}` } }), h('span', { class: 'nm', style: { fontSize: '15px' } }, you ? 'Your Hold' : wardenName(w))),
          oreOf(w) > 0 && !you ? h('span', { style: { fontSize: '12.5px', color: 'var(--root)' } }, `${oreOf(w)} wildroot`)
            : you ? ''
              : sleptFor(w) > 600 ? h('span', { class: 'faint', style: { fontSize: '12.5px' }, title: 'Not stirred for a long while: unlikely to defend' }, 'asleep') : ''),
        ));
      }
    }
    // the chosen one is lit in place: choosing does not rebuild hundreds of rows
    const w = all[sel];
    for (const b of list.querySelectorAll<HTMLElement>('.item')) b.classList.toggle('on', !!w && b.dataset.key === w.id);
    // the sky could not be read: say so plainly (and keep saying it), with a way to ask again
    const down = failed && !all.length;
    const count = all.length ? `${shown.length} of ${all.length} wardens · newest on the ledger` : 'Reading the ledger…';
    if (changed('foot', down ? 'down' : count)) {
      if (down) { clear(foot); foot.append('The ledger is not answering just now. ', h('button', { type: 'button', class: 'linkish', onclick: () => again() }, 'Try again')); }
      else foot.textContent = count;
    }
    scout(w && w.id !== meId ? w.id : null);
    paintCard(w, meId);
    if (changed('legend', JSON.stringify(covens.map((c) => [c, name(c)])))) {
      clear(legend);
      for (const c of covens) legend.append(h('span', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'gem', style: { background: covenColor(c) } }), name(c)));
    }
  }

  /** The chosen isle's card. Built once per warden; only its facts and the scouting change as the ledger moves. */
  function paintCard(w: Warden | undefined, meId: string | undefined) {
    const you = !!w && w.id === meId;
    if (changed('card', JSON.stringify(w ? [w.id, you, name(w.guildId), oreOf(w), sightOk] : null))) {
      clear(card); facts = scoutBox = null; delete sigs.facts; delete sigs.scout;
      if (w) {
        // it rises when a warden is chosen, not every time it is built again
        const fresh = w.id !== cardFor;
        facts = h('div');
        scoutBox = you ? null : h('div');
        card.append(h('section', { class: 'glass panel' + (fresh ? ' rise' : ''), 'aria-label': 'Chosen isle', style: { flex: '0 1 360px', minWidth: '280px', padding: '20px' } },
          h('p', { class: 'eyebrow row', style: { color: covenColor(w.guildId), gap: '8px' } }, h('span', { class: 'gem', style: { background: covenColor(w.guildId), width: '8px', height: '8px' } }), name(w.guildId)),
          h('h1', { class: 'display', style: { fontSize: '36px', marginTop: '6px', overflowWrap: 'anywhere' } }, you ? 'Your Hold' : wardenName(w)),
          facts,
          h('details', { class: 'more', open: marksOpen.has(w.id), ontoggle: (e: Event) => { if ((e.target as HTMLDetailsElement).open) marksOpen.add(w.id); else marksOpen.delete(w.id); } }, h('summary', { 'data-key': 'marks' }, 'Ledger marks'),
            h('dl', { class: 'facts' },
              h('div', null, h('dt', null, 'Warden'), h('dd', { class: 'mono' }, w.id)),
              h('div', null, h('dt', null, 'Isle'), h('dd', { class: 'mono' }, w.planetId)),
              h('div', null, h('dt', null, 'Coven'), h('dd', { class: 'mono' }, w.guildId || '—')),
              h('div', null, h('dt', null, 'Warband'), h('dd', { class: 'mono' }, w.fleetId || '—')))),
          you ? h('p', { style: { margin: '14px 0 0', fontSize: '15px', color: '#cfc5dd' } }, 'Your own isle, drifting where the old sky set it.') : scoutBox,
          // One road to a raid: the Skirmish walks it step by step (ride out, strike, plunder).
          you ? h('a', { class: 'btn gold block', href: '/hold', style: { marginTop: '16px', minHeight: '54px' } }, 'Go to your Hold')
            : h('a', { class: 'btn ember block', href: `/skirmish/${w.id}`, 'data-tut': 'ride', style: { marginTop: '16px', minHeight: '54px', fontSize: '17px' } }, 'Raid this hold', icon(ICON.arrow, 18)),
          // a raid on an empty hold only breaks things: say so before the ride
          !you && sightOk && oreOf(w) === 0 ? h('p', { class: 'faint', style: { margin: '6px 0 0', fontSize: '13px' } }, 'Nothing unbrewed to plunder there right now. Amber isles hold a prize.') : '',
          you ? '' : h('div', { class: 'row', style: { marginTop: '8px', gap: '8px' } },
            h('a', { class: 'btn small', href: `/hold/${w.id}`, style: { flex: '1' } }, 'Scry their isle'),
            h('button', { type: 'button', class: 'btn small', style: { flex: '1' }, onclick: () => rideOut(w) }, 'Just ride there')),
          h('button', { type: 'button', class: 'btn ghost block', style: { marginTop: '10px' }, onclick: () => pick(null) }, 'Back to the whole sky')));
      }
      cardFor = w?.id ?? null;
    }
    if (!w) return;
    // how long they have slept moves with every bell: only those words change, not the card
    const stirred = you ? '' : sleptFor(w) ? (sleptFor(w) > 14400 ? 'long asleep: unlikely to defend' : `${bellsAsTime(sleptFor(w))} ago`) : '—';
    if (facts && changed('facts', stirred)) facts.replaceChildren(h('dl', { class: 'facts' },
      h('div', null, h('dt', null, 'Coven'), h('dd', null, w.guildId ? name(w.guildId) : 'none')),
      you ? null : h('div', null, h('dt', null, 'Last stirred'), h('dd', null, stirred)),
      h('div', { style: { gridColumn: 'span 2' } }, h('dt', null, you ? 'Unbrewed wildroot (raiders could take it)' : 'Wildroot to plunder'), h('dd', { style: { color: oreOf(w) > 0 ? 'var(--root)' : undefined } }, oreOf(w) > 0 ? `${oreOf(w)} ${oreOf(w) === 1 ? 'sheaf' : 'sheaves'}` : 'none — nothing to take'))));
    // the scouting is read again on every ledger change; it holds no controls, so its words are its signature
    if (scoutBox) { const sb = scoutBlock(w.id); if (changed('scout', sb.outerHTML)) scoutBox.replaceChildren(sb); }
  }

  function rideOut(w: Warden) {
    const p = empire.commander;
    if (!p) { toast('Swear the oath first: you have no warband to ride.', 'warn', 5000, { label: 'Oath', run: ctx.oath }); return; }
    if (!wallet.unlocked) { toast('Your soulstone is sealed.', 'warn', 5000, { label: 'Unseal', run: ctx.oath }); return; }
    const full = skyFull(empire.players.get(w.id)?.planet, p);
    if (full) { toast(full, 'warn', 7000); return; }
    try {
      act.fleetMove(p, w.planetId);
      scene?.get()?.ride(sel);
      toast(`Your warband rides for ${wardenName(w)}’s isle. When it lands, the plunder chant can begin.`, 'player', 6000, { label: 'To war', run: () => ctx.go(`/skirmish/${w.id}`) });
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
      covens, colors, isles: all.map((w) => ({ id: w.id, coven: w.guildId, you: w.id === meId })), onPick: (i: number) => pick(i), onView: (m: boolean) => world.moved(m),
      onHover: (i: number | null) => {
        const w = i == null ? undefined : all[i], you = w?.id === empire.commander?.playerId;
        tip.show(w ? (you ? 'Your Hold' : wardenName(w)) : null, w && !you && oreOf(w) > 0 ? `${oreOf(w)} wildroot to plunder` : 'click to look closer');
      },
    }), (c) => { c.glowRich(all.map((w) => oreOf(w))); if (focus) { const i = all.findIndex((w) => w.id === focus); if (i >= 0) pick(i); } framer.soon(); });
    paint();
  }
  // the foot is written here, outside paint: forget its signature so the next paint writes it again
  again = () => { clearTimeout(retry); delete sigs.foot; foot.textContent = 'Asking the ledger again…'; void read(); };
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
  return { el, title: 'Sky Atlas', leave: () => { left = true; framer.dispose(); offWorld(); world.dispose(); offMe(); offScout(); offSight(); scout(null); clearTimeout(retry); scene?.dispose(); tip.dispose(); bar.dispose(); } };
}
