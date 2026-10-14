/* The Hold: your isle, read live from the ledger. Every beast and hallow is a struct you own;
 * every button signs a real transaction through the rite queue. `/hold/<playerId>` watches
 * another warden's hold, read-only. */
import { h, clear, toast, confirmBox, keepFocus } from '../core/dom';
import K from '../world/wyrmkit.js';
import { mountScene, type Ctx, type Screen } from './types';
import { topbar, hearts, icon, ICON } from '../ui/frame';
import { chantsPanel, chroniclePanel } from '../ui/chants';
import { empire, type OwnedStruct, type PlayerState } from '../game/empire';
import { act, actionBlock, buildBlock, canRetry, exploreConfirmed, verbsFor } from '../game/actions';
import { wallet } from '../wallet/wallet';
import { txq, type TxJob } from '../wallet/queue';
import { claimJob, releaseClaim } from '../core/claims';
import { markPath, pathHas } from '../ui/guide';
import { STRUCT_TYPES, typeOf, type Ambit } from '../data/catalogue';
import { num } from '../chain/lcd';
import { live } from '../chain/live';
import { AMBIT_OF_REALM, HALLOW_COLOR, REALMS, REALM_COLOR, REALM_NAME, WARD_CRAFT, beastName, fmtAlpha, fmtBreath, fmtMana, lore, reachOf, retell, retellError, sheaves, type Realm } from '../lore';
import { freeCircle, owned, playerName, raidersAt, realmOf, unitsOf } from '../realm';
import { glyph } from '../ui/glyphs';
import { holdTour } from '../ui/tour';
import { cursorTip } from '../ui/tip';
import { proclaim } from '../ui/omens';
import { chantTime } from '../ui/chants';

/** An isle by its warden's name, never its ledger mark. */
const isleName = (planetId: string) => { for (const pl of empire.players.values()) if (pl.planetId === planetId) return `${playerName(pl)}’s isle`; return 'a far isle'; };
const VERB_NAME: Record<string, string> = { on: 'Awaken', off: 'Slumber', stealth: 'Veil', unstealth: 'Drop veil', undefend: 'Stand down', cancel: 'Abandon the summoning' };

export function hold(ctx: Ctx): Screen {
  const watching = ctx.param && !wallet.byPlayer(ctx.param) ? ctx.param : null;
  const swornHere = () => !!wallet.active?.playerId;
  /** How long this warden's hold has been awaited: timed per warden, from when we started waiting for them. */
  let readingFor: string | undefined, readingSince = Date.now(), slowCheck = 0;
  function trackReading() {
    const pid = ctx.param || wallet.active?.playerId;
    if (pid === readingFor) return;
    readingFor = pid; readingSince = Date.now();
    clearTimeout(slowCheck); slowCheck = window.setTimeout(() => paint(), 15500);
  }
  if (watching) empire.watch(watching);
  const player = (): PlayerState | null => (watching ? empire.players.get(watching) ?? null : ctx.param ? empire.players.get(ctx.param) ?? null : empire.commander);

  let sel: string | null = null;
  let filter: Realm | 'all' | 'hallows' = 'all';
  let first = true;
  let raiders: { fleetId: string; owner: string }[] = [];
  let raidCheckAt = 0;
  const checkRaiders = () => {
    const p = player();
    if (!p?.planet || Date.now() - raidCheckAt < 4000) return;
    raidCheckAt = Date.now();
    void raidersAt(p.planet).then((r) => { if (JSON.stringify(r) !== JSON.stringify(raiders)) { raiders = r; paint(); } });
  };

  const canvas = h('canvas');
  const bar = topbar('/hold', ctx.oath, { meters: true });
  const chants = chantsPanel();
  chants.el.setAttribute('data-tut', 'chants');
  const chron = chroniclePanel((j) => { const p = player(); return !!p && j.playerId === p.playerId; });
  const omens = h('div', { class: 'stack hold-omens', style: { alignItems: 'center' } });
  const filters = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by realm' });
  const roster = h('ul', { class: 'list scroll-y' });
  const rosterHead = h('div', { class: 'row between' });
  const card = h('section', { class: 'glass panel', 'aria-label': 'Chosen beast' });
  const rites = h('nav', { class: 'glass rites', 'aria-label': 'Rites' });
  const banner = h('div');

  const rosterPanel = h('aside', { class: 'glass panel col-l roster-panel', 'aria-label': 'Bound to you' }, rosterHead, filters, roster);
  const el = h('div', { class: 'screen' },
    h('div', { class: 'stage' }, canvas),
    h('div', { class: 'hud' }, bar.el, banner, omens,
      // on a phone the panels stack: this keeps a clear window onto the isle above them
      h('div', { class: 'isle-window', 'aria-hidden': 'true' }),
      h('div', { class: 'cols through' },
        rosterPanel,
        h('div', { class: 'col-r' }, card, chants.el, chron.el)),
      rites));

  const tip = cursorTip(canvas);
  const scene = mountScene(canvas, (c) => K.hold(c, { units: [], onPick: (id: string | null) => pick(id), onHover: (id: string | null) => {
    const s = id ? player()?.structs.get(id) : undefined;
    tip.show(s?.type ? beastName(s.typeId) : null, watching ? 'theirs' : 'click to see what it can do');
  } }), () => paint());

  function pick(id: string | null) {
    sel = id; scene.get()?.select(id);
    if (cardNote && cardNote.sid !== id) cardNote = null;
    const p = player();
    if (id && p && empire.commands(p.playerId) && p.structs.get(id)?.typeId === 1) markPath('wyrm');
    paint();
  }

  /** Run a rite, or say why it can't be spoken. */
  /** A rite started from the beast card speaks its trouble on that card, beside its buttons. */
  let cardNote: { sid: string; text: string; label?: string; run?: () => void } | null = null;
  const watching$: (() => unknown)[] = [];
  const pendingClaims = new Set<string>();
  function note(sid: string | undefined, text: string, label?: string, run?: () => void) {
    if (!sid) { toast(text, 'enemy', 6000, label && run ? { label, run } : undefined); return; }
    cardNote = { sid, text, label, run };
    paintCard(player());
  }
  function rite(p: PlayerState, run: () => unknown, needsGrid = true, sid?: string) {
    if (!empire.commands(p.playerId)) { toast('This hold is not yours to command.', 'warn'); return; }
    if (!wallet.unlocked) { note(sid, 'Your soulstone is sealed.', 'Unseal', ctx.oath); return; }
    const why = needsGrid ? actionBlock(p) : null;
    if (why) { note(sid, retellError(why)); return; }
    if (sid && cardNote?.sid === sid) { cardNote = null; paintCard(p); }
    try {
      const job = run() as TxJob | undefined;
      if (sid && job && typeof job === 'object' && 'id' in job) {
        claimJob(job.id); pendingClaims.add(job.id);
        const off = txq.onSettled((j) => {
          if (j.id !== job.id) return;
          off(); pendingClaims.delete(j.id);
          if (j.status !== 'failed') return;
          const text = `That rite did not land: ${retellError(j.error || 'the ledger refused')}.`;
          // trying again goes back through rite, so a second failure is heard too; a stale one is not sent blind
          const again = () => {
            if (!canRetry(j)) { note(sel === sid ? sid : undefined, 'That was a while ago, and the sky has moved on. Start the rite afresh if you still want it.'); return; }
            rite(p, () => { txq.retry(j.id); return j; }, needsGrid, sel === sid ? sid : undefined);
          };
          // the card now shows another beast: say it at the edge instead of losing it
          const offer = canRetry(j);
          if (sel !== sid) toast(text, 'enemy', 8000, offer ? { label: 'Try again', run: again } : undefined);
          else if (offer) note(sid, text, 'Try again', again); else note(sid, text);
        });
        watching$.push(off);
      }
    } catch (e) { note(sid, retellError((e as Error).message)); }
  }

  function stateOf(s: OwnedStruct): [string, string] {
    if (!s.built) return ['Being summoned', 'var(--gold)'];
    if (!s.online) return ['Slumbering', 'var(--faint)'];
    if (s.hidden) return ['Veiled', 'var(--violet)'];
    if (s.protectedStructIndex) return ['On guard', 'var(--violet)'];
    return ['Awake', '#7dffb0'];
  }

  /** While you were away: what changed in your hold since your last visit (kept per warden). */
  let away: string | null = null, awayRead = false, awaySaved = 0;
  const awayKey = (pid: string) => `wyrmhold.away.${pid}`;
  function readAway(p: PlayerState) {
    if (awayRead) return;
    awayRead = true;
    try {
      const was = JSON.parse(localStorage.getItem(awayKey(p.playerId)) || 'null') as { at: number; alpha: string; ore: number } | null;
      if (!was || Date.now() - was.at < 20 * 60_000) return;
      const da = p.alpha - BigInt(was.alpha), dr = p.ore - was.ore, bits: string[] = [];
      if (da > 0n) bits.push(`+${fmtAlpha(da)} alpha brewed`);
      if (dr > 0) bits.push(`+${dr} wildroot dug`);
      if (dr < 0 && da <= 0n) bits.push(`${-dr} wildroot gone (plundered?)`);
      if (bits.length) away = `While you were away: ${bits.join(' · ')}.`;
    } catch { /* nothing to tell */ }
  }
  function saveAway(p: PlayerState) {
    if (Date.now() - awaySaved < 30_000) return;
    awaySaved = Date.now();
    try { localStorage.setItem(awayKey(p.playerId), JSON.stringify({ at: Date.now(), alpha: p.alpha.toString(), ore: p.ore })); } catch { /* ignore */ }
  }

  function paintOmens(p: PlayerState | null) {
    clear(omens);
    // omens queue up; the most urgent two show, the rest wait behind "more"
    const queued: { rank: number; el: HTMLElement }[] = [];
    const omen = (tone: 'ember' | 'gold' | 'teal', text: string, action?: [string, () => void]) => queued.push({ rank: tone === 'ember' ? 0 : tone === 'gold' ? 1 : 2, el: h('div', { role: 'status', class: 'glass row', style: {
      padding: '8px 10px 8px 16px', borderRadius: '999px', fontSize: '15px', flexWrap: 'nowrap',
      borderColor: tone === 'ember' ? 'rgba(255,122,77,.55)' : tone === 'gold' ? 'rgba(232,200,114,.5)' : 'rgba(95,211,181,.5)',
      background: tone === 'ember' ? 'rgba(60,24,18,.82)' : undefined, color: tone === 'ember' ? 'var(--ember-ink)' : undefined,
    } }, h('span', null, text), action ? h('button', { type: 'button', class: 'btn small', onclick: action[1] }, action[0]) : null) });
    if (!p) return;
    const mine = empire.commands(p.playerId);
    if (mine && !watching) { readAway(p); saveAway(p); if (away) omen('gold', away, ['Got it', () => {
      away = null;
      keepFocus(omens, () => paintOmens(player()));
      // the button that had focus is gone with its notice: hold focus on the notices themselves
      if (!omens.contains(document.activeElement)) { omens.tabIndex = -1; ((omens.querySelector('button') as HTMLElement | null) ?? omens).focus({ preventScroll: true }); }
    }]); }
    // the one safety step that matters most: a soulstone whose words were never kept
    if (mine && !watching && wallet.unlocked && wallet.deviceSealed && !wallet.backedUp) omen('ember', 'Your soul-words are not kept anywhere yet. If this browser forgets you, your warden is lost.', ['Keep them', () => ctx.oath('words')]);
    const wyrmAlive = [...p.structs.values()].some((s) => s.typeId === 1 && !s.destroyed);
    const who = (pid: string) => (wallet.byPlayer(pid) ? 'your' : `${empire.players.get(pid) ? playerName(empire.players.get(pid)!) : 'another warden'}’s`);
    if (p.planetId && !wyrmAlive && !mine) omen('gold', p.ore > 0 ? 'Their Elder Wyrm has fallen: this hold lies open to any raider.' : 'Their Elder Wyrm has fallen, but they hold no unbrewed wildroot to take.', p.ore > 0 ? ['Plan a raid', () => ctx.go(`/skirmish/${p.playerId}`)] : undefined);
    if (p.planetId && !wyrmAlive && mine) omen('ember', 'Your Elder Wyrm has fallen. Until a new one hatches, your hold lies open to any raider.', ['Hatch anew', () => {
      const t = typeOf(1);
      if (!t) return;
      if (p.capacity + p.connectionCapacity - p.load - p.structsLoad < BigInt(t.buildDraw)) { toast('Not enough spare mana to hatch a Wyrm. Let something slumber, or feed a spring.', 'warn', 6000); return; }
      rite(p, () => act.build(p, t, 'land', 0), false);
      toast('An egg is laid in the Wilds. The hatching chant begins as soon as the circle lands.', 'player', 5000);
    }]);
    for (const r of raiders) {
      if (mine) omen('ember', `Raiders hang over your isle: ${who(r.owner)} warband. Fell their Elder Wyrm and the plunder breaks.`, ['Defend', () => ctx.go(`/skirmish/${r.owner}`)]);
      else omen('gold', `${who(r.owner).replace(/^y/, 'Y')} warband hangs over this isle. Fell their Elder Wyrm and the plunder chant runs.`, wallet.byPlayer(r.owner) ? ['Fight', () => ctx.go(`/skirmish/${p.playerId}`)] : undefined);
    }
    if (!p.online) omen('ember', mine ? 'Your leylines are overdrawn: every beast gutters until load fits the flow. Slumber something, or feed a spring.' : 'Their leylines are overdrawn: their beasts gutter.');
    if (p.ore > 0 && !mine) omen('gold', `${sheaves(p.ore)} of their wildroot ${p.ore === 1 ? 'lies' : 'lie'} unbrewed: a raid could carry ${p.ore === 1 ? 'it' : 'them'} off.`, ['Plan a raid', () => ctx.go(`/skirmish/${p.playerId}`)]);
    // only a Cauldron that stands awake on this isle is really brewing (as the chant engine sees it)
    const brewing = p.online && [...p.structs.values()].some((x) => x.typeId === 15 && !x.destroyed && x.built && x.online && x.locationId === p.planetId);
    if (p.ore > 0 && mine) omen('ember', brewing
      ? `${p.ore === 1 ? 'A sheaf of wildroot waits' : `${p.ore} sheaves of wildroot wait`} in your stores. Your Dawn Cauldron is brewing ${p.ore === 1 ? 'it' : 'them'} into alpha; until then raiders can steal ${p.ore === 1 ? 'it' : 'them'}.`
      : p.ore === 1 ? 'A sheaf of wildroot waits in your stores. Raiders can steal it until a Dawn Cauldron brews it into alpha.' : `${p.ore} sheaves of wildroot wait in your stores. Raiders can steal them until a Dawn Cauldron brews them into alpha.`, owned(p, 15) || !mine ? undefined : ['Summon a Cauldron', () => summonDialog(p, 15)]);
    if (p.fleet?.status === 'away') omen('gold', mine ? `Your warband is abroad at ${isleName(p.fleet.locationId)}. Your hold has no beasts to defend it.` : 'Their warband is abroad: this hold has no beasts to defend it.', mine ? ['Ride home', () => rite(p, () => act.fleetMove(p, p.planetId), false)] : undefined);
    const ground = num(p.planet?.gridAttributes?.ore);
    if (!p.planetId || (p.planet && ground <= 0 && p.ore === 0)) omen('teal', !mine ? (p.planetId ? 'Their isle is spent: nothing left to dig or take.' : 'This warden holds no isle.') : p.planetId ? 'Your isle is spent: no wildroot left in its marrow.' : 'You hold no isle yet.', mine ? [p.planetId ? 'Seek a new isle' : 'Find your first isle', () => rite(p, () => exploreConfirmed(p), false)] : undefined);
    // a brand-new warden hears one next step at a time: first meet the Wyrm (Ysolde says so), then this
    else if (ground > 0 && !owned(p, 14) && mine && pathHas('wyrm')) omen('teal', `The ground of your isle still holds ${sheaves(ground)} of wildroot. A Root Delver would dig ${ground === 1 ? 'it' : 'them'} up.`, ['Summon a Delver', () => summonDialog(p, 14)]);
    const sorted = queued.map((q, i) => ({ ...q, i })).sort((a, b) => a.rank - b.rank || a.i - b.i);
    // a short screen hears the most urgent notice only, so the roster below keeps its room
    const room = matchMedia('(min-width: 721px) and (max-height: 780px)').matches ? 1 : 2;
    const shown = omensAll ? sorted : sorted.slice(0, room);
    omens.append(...shown.map((q) => q.el));
    if (sorted.length > room) omens.append(h('button', { type: 'button', class: 'omens-more', 'data-key': 'omens-more', onclick: () => { omensAll = !omensAll; keepFocus(omens, () => paintOmens(player())); } },
      omensAll ? 'Show fewer' : `${sorted.length - room} more ${sorted.length - room === 1 ? 'notice' : 'notices'}`));
  }
  let omensAll = false;

  function paintRoster(p: PlayerState | null) {
    clear(rosterHead); clear(filters); clear(roster);
    // its name matches whose hold this is
    rosterPanel.setAttribute('aria-label', watching ? (p ? `Bound to ${playerName(p)}` : 'Bound to them') : 'Bound to you');
    const structs = p ? [...p.structs.values()].filter((s) => !s.destroyed && s.type) : [];
    rosterHead.append(h('h2', { class: 'display' }, watching ? (p ? `Bound to ${playerName(p)}` : 'Bound to them') : 'Bound to you'), h('span', { class: 'mono faint', style: { fontSize: '12px' } }, `${structs.length} bound`));
    const count = (f: typeof filter) => structs.filter((s) => f === 'all' || (f === 'hallows' ? s.type!.category === 'planet' : s.type!.category === 'fleet' && realmOf(s) === f)).length;
    const opts: [typeof filter, string, string][] = [['all', 'All', HALLOW_COLOR], ...REALMS.map((r) => [r, REALM_NAME[r], REALM_COLOR[r]] as [Realm, string, string]), ['hallows', 'Hallows', HALLOW_COLOR]];
    // A handful of beasts needs no sorting: the realm chips appear once the warband grows.
    filters.hidden = structs.length < 5 && filter === 'all';
    for (const [k, label, color] of opts) filters.append(h('button', { type: 'button', class: 'chip' + (filter === k ? ' on' : ''), 'aria-pressed': String(filter === k), onclick: () => {
      filter = k; scene.get()?.focus(k === 'hallows' ? 'wilds' : k); paint();
    } }, h('span', { class: 'gem', style: { background: color, width: '8px', height: '8px' } }), label, h('span', { class: 'n' }, String(count(k)))));
    if (!p) { roster.append(h('li', null, h('p', { class: 'empty' }, watching ? 'Reading their hold from the ledger…' : swornHere() ? 'Reading your warband from the ledger…' : 'No warden is bound to this soulstone yet.'))); return; }
    const shown = structs.filter((s) => filter === 'all' || (filter === 'hallows' ? s.type!.category === 'planet' : s.type!.category === 'fleet' && realmOf(s) === filter))
      .sort((a, b) => (a.type!.category === 'planet' ? 1 : 0) - (b.type!.category === 'planet' ? 1 : 0) || a.typeId - b.typeId);
    if (!shown.length) roster.append(h('li', null, h('p', { class: 'empty', style: { fontSize: '15px' } }, 'None bound in this realm.')));
    for (const s of shown) {
      const [state, color] = stateOf(s);
      const hallow = s.type!.category === 'planet';
      const away = !hallow && p.fleet?.status === 'away';
      const gem = hallow ? HALLOW_COLOR : REALM_COLOR[realmOf(s)];
      roster.append(h('li', null, h('button', { type: 'button', class: 'item' + (sel === s.id ? ' on' : ''), 'data-key': s.id, 'data-tut': s.typeId === 1 ? 'wyrm' : null, onclick: () => pick(s.id) },
        h('span', { class: 'l' }, h('span', { class: 'gem', style: { background: gem, boxShadow: `0 0 10px ${gem}` } }),
          h('span', { style: { minWidth: '0' } }, h('span', { class: 'nm' }, beastName(s.typeId)),
            h('span', { class: 'sub', style: { color } }, (hallow ? 'Hallow' : REALM_NAME[realmOf(s)]) + ' · ' + (away ? 'Riding abroad' : state)))),
        h('span', { class: 'hearts', role: 'img', 'aria-label': `vigor ${s.health} of ${s.type!.maxHealth}` }, hearts(s.health, s.type!.maxHealth)))));
    }
  }

  const moreOpen = new Set<string>();
  function paintCard(p: PlayerState | null) {
    clear(card);
    const s = p && sel ? p.structs.get(sel) : undefined;
    if (!p || !s || !s.type) {
      card.append(h('p', { class: 'empty' }, p ? (watching ? 'Touch one of their beasts to learn what it can do.' : 'Touch a beast or hallow on your isle, or choose one from the list.') : watching || swornHere() ? 'Reading the ledger…' : 'Swear the oath and your Elder Wyrm will hatch here.'),
        !p && !watching && !swornHere() ? h('button', { type: 'button', class: 'btn gold', style: { marginTop: '12px' }, onclick: ctx.oath }, 'Swear the oath') : '');
      return;
    }
    const t = s.type, L = lore(s.typeId), hallow = t.category === 'planet';
    const [state, color] = stateOf(s);
    const reach = [...new Set([...reachOf(t.primaryWeaponAmbits), ...reachOf(t.secondaryWeaponAmbits)])];
    const mine = empire.commands(p.playerId);
    card.append(
      h('div', { class: 'row between', style: { alignItems: 'flex-start', flexWrap: 'nowrap' } },
        h('div', null,
          h('p', { class: 'eyebrow', title: `Ledger mark ${s.id}`, style: { color: hallow ? HALLOW_COLOR : REALM_COLOR[realmOf(s)] } }, hallow ? 'Hallow' : `${REALM_NAME[realmOf(s)]} realm`),
          h('h3', { class: 'display', style: { fontSize: '30px', marginTop: '4px' } }, L.name),
          h('p', { class: 'italic', style: { margin: '4px 0 0' } }, L.epithet)),
        h('span', { class: 'hearts', role: 'img', 'aria-label': `vigor ${s.health} of ${t.maxHealth}`, style: { fontSize: '16px' } }, hearts(s.health, t.maxHealth))),
      h('dl', { class: 'facts' },
        h('div', null, h('dt', null, 'State'), h('dd', { style: { color } }, state)),
        h('div', null, h('dt', null, 'Mana draw'), h('dd', null, fmtMana(t.passiveDraw))),
        // hallows neither strike nor dodge: only beasts list their reach and ward-craft
        hallow ? null : h('div', null, h('dt', null, 'Strikes into'), h('dd', null, s.typeId === 1 ? 'Its own realm' : reach.length ? reach.map((r) => REALM_NAME[r]).join(', ') : '—')),
        hallow ? null : h('div', null, h('dt', null, 'Ward-craft'), h('dd', null, WARD_CRAFT[t.unitDefenses] || 'None'))),
      // a beast still being summoned: say where its progress shows and that it needs nothing more
      !s.built ? h('p', { class: 'path-wait', style: { marginTop: '10px' } }, h('span', { class: 'k' }, 'Summoning'),
        mine && wallet.unlocked ? 'Its chant is being sung in Incantations below. It wakes on its own when the chant lands.' : 'Its summoning is not finished yet.') : '',
      h('p', { style: { margin: '12px 0 0', fontSize: '15px', color: '#cfc5dd' } }, L.tale));
    if (!mine) { card.append(h('p', { class: 'faint', style: { marginTop: '12px', fontSize: '14px' } }, 'You are watching. Only its warden can command it.')); return; }
    const row = h('div', { class: 'row', style: { marginTop: '14px' } });
    // Safe rites lead; the ones that cannot be taken back wait behind "More".
    const more = h('div', { class: 'row', style: { marginTop: '10px' } });
    // a slumbering Wyrm halts every summoning: that switch waits behind "More" too
    for (const v of verbsFor(p, s)) (v.danger || (v.id === 'off' && s.typeId === 1) ? more : row).append(h('button', { type: 'button', class: v.danger ? 'btn small ghost' : 'btn small', style: v.danger ? { color: 'var(--ember-ink)' } : undefined, title: retellError(v.hint), onclick: () => rite(p, v.run, v.id !== 'off' && v.id !== 'cancel', s.id) },
      VERB_NAME[v.id] || retell(v.label), v.cost ? h('span', { class: 'cost' }, `${v.cost} breath`) : null));
    if (s.built && t.generatingRate > 0) row.append(h('button', { type: 'button', class: 'btn small', onclick: () => feedDialog(p, s) }, 'Feed alpha'));
    if (s.built && !hallow && s.typeId !== 1 && !s.protectedStructIndex) row.append(h('button', { type: 'button', class: 'btn small', onclick: () => guardDialog(p, s) }, 'Guard…', h('span', { class: 'cost' }, `${t.defendChangeCharge} breath`)));
    if (!hallow) row.append(h('a', { class: 'btn small', href: '/skirmish', style: { borderColor: 'rgba(255,122,77,.5)', color: 'var(--ember-ink)' } }, 'Raid with it'));
    if (s.built && s.typeId !== 1) more.append(h('button', { type: 'button', class: 'btn small ghost', style: { color: 'var(--ember-ink)' }, onclick: async () => {
      if (await confirmBox(`Banish the ${L.name}?`, 'It is released for good. Its circle frees for another summoning.', 'Banish')) rite(p, () => act.trash(p, s), true, s.id);
    } }, 'Banish'));
    card.append(row);
    // the one easy switch with a hidden cost: say it where it is pressed
    if (s.online && s.built && hallow && (t.planetaryMining !== 'noPlanetaryMining' || t.planetaryRefinery !== 'noPlanetaryRefinery' || t.generatingRate > 0)) card.append(h('p', { class: 'faint', style: { margin: '6px 0 0', fontSize: '12.5px' } }, `Slumber frees its ${fmtMana(t.passiveDraw)} mana, but it does no work while it sleeps.`));
    if (cardNote && cardNote.sid === s.id) {
      const n = cardNote;
      card.append(h('p', { class: 'inline-err', role: 'alert' }, icon(ICON.warn, 15), h('span', null, n.text),
        n.label && n.run ? h('button', { type: 'button', class: 'linkish', onclick: () => { cardNote = null; n.run!(); paintCard(player()); } }, n.label) : null));
    }
    // the card is rebuilt as the ledger moves: remember which "More" the warden left open
    if (more.childElementCount) card.append(h('details', { class: 'more', open: moreOpen.has(s.id), ontoggle: (e: Event) => { if ((e.target as HTMLDetailsElement).open) moreOpen.add(s.id); else moreOpen.delete(s.id); } }, h('summary', { 'data-key': 'more:' + s.id }, 'More'), more));
    if (s.typeId === 1 && s.built) {
      card.append(h('div', { role: 'group', 'aria-label': 'Soar to a realm', style: { marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(243,235,221,.1)' } },
        h('p', { class: 'label', style: { margin: '0 0 4px' } }, `Soar to · ${t.moveCharge} breath`),
        h('p', { class: 'faint', style: { margin: '0 0 8px', fontSize: '12.5px' } }, 'It strikes only beasts in the realm where it stands.'),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '6px' } }, ...REALMS.map((r) => {
          const here = realmOf(s) === r;
          return h('button', { type: 'button', class: 'chip' + (here ? ' on' : ''), 'aria-pressed': String(here), style: { justifyContent: 'center', minHeight: '40px', borderColor: here ? REALM_COLOR[r] : undefined },
            onclick: () => { if (!here) rite(p, () => act.move(p, s, 'fleet', AMBIT_OF_REALM[r], 0), true, s.id); } }, REALM_NAME[r]);
        }))));
    }
  }

  // the rites are rebuilt only when what they say changes: a glow from Ysolde, a hover or a
  // press is not reset on every bell. Their handlers read the newest record, not a stale one.
  let ritesSig = '', riteP: PlayerState | null = null;
  function paintRites(p: PlayerState | null) {
    riteP = p;
    const mine = !!p && empire.commands(p.playerId);
    const sig = [mine, watching, swornHere(), p?.playerId, p?.planetId, num(p?.planet?.gridAttributes?.ore) > 0, p?.fleet?.status].join('|');
    if (sig === ritesSig && rites.childElementCount) return;
    ritesSig = sig;
    clear(rites);
    const face = (mark: string, label: string, sub: string, color: string) => [h('span', { class: 'rite-mark', style: { color } }, glyph(mark, 24)), h('b', { style: { color } }, label), h('small', null, sub)];
    const btn = (mark: string, label: string, sub: string, color: string, run: () => void, disabled = false, tut?: string) =>
      h('button', { type: 'button', class: 'rite', disabled, 'data-tut': tut || null, onclick: run }, ...face(mark, label, sub, color));
    const link = (mark: string, label: string, sub: string, color: string, href: string) => h('a', { class: 'rite', href }, ...face(mark, label, sub, color));
    if (!p || !mine) {
      // a sworn warden whose hold is still being read is not offered the oath again
      if (watching) rites.append(link('raid', 'Plan a raid', 'on this hold', 'var(--ember)', '/skirmish/' + (p?.playerId || watching)));
      else if (!swornHere()) rites.append(btn('oath', 'Swear the oath', 'bind · swear · seek', 'var(--gold)', ctx.oath));
      rites.append(link('atlas', 'Sky Atlas', 'every warden', 'var(--violet)', '/atlas'));
      return;
    }
    rites.append(
      btn('summon', 'Summon', '8 breath', 'var(--gold)', () => { if (riteP) summonDialog(riteP); }, false, 'summon'),
      btn('seek', 'Seek Isle', !p.planetId ? 'begin here' : !p.planet ? 'a new shard' : num(p.planet?.gridAttributes?.ore) > 0 ? 'once yours is dug out' : 'yours is dug out', 'var(--violet)', () => { const q = riteP; if (q) rite(q, () => exploreConfirmed(q), false); }, false, 'seek'),
      p.fleet?.status === 'away'
        ? btn('home', 'Ride Home', 'your hold is unguarded', 'var(--sky)', () => { const q = riteP; if (q) rite(q, () => act.fleetMove(q, q.planetId), false); })
        : link('ride', 'Ride Out', 'find a foe', 'var(--sky)', '/atlas'),
      link('skirmish', 'Skirmish', 'strike & plunder', 'var(--ember)', '/skirmish'),
      link('bestiary', 'Bestiary', 'know your beasts', 'var(--verdigris)', '/bestiary'));
  }

  /** A dialog the Hold opens gives focus back to whatever opened it when it closes, however it closes. */
  function returnFocusOnClose(veil: HTMLElement) {
    const opener = document.activeElement as HTMLElement | null;
    const mo = new MutationObserver(() => {
      if (veil.isConnected) return;
      mo.disconnect();
      if (opener && opener.isConnected && (!document.activeElement || document.activeElement === document.body)) opener.focus({ preventScroll: true });
    });
    mo.observe(document.body, { childList: true });
  }

  function summonDialog(p: PlayerState, only?: number) {
    const ch = empire.charge(p);
    const list = h('div', { class: 'scroll-y summon-list', style: { padding: '4px 2px', maxHeight: '62vh' } });
    // What a new warden needs first leads; then mana, wards, and the beasts of war.
    const next = !owned(p, 14) ? 14 : !owned(p, 15) ? 15 : 0;
    // real times, as the Incantations panel tells them: a chant ripens with the bells, open or closed
    const dig = chantTime(typeOf(14)?.oreMiningDifficulty || 14000), brew = chantTime(typeOf(15)?.oreRefiningDifficulty || 28000);
    const GROUPS: [string, string, number[]][] = [
      ['Grow your hold', `Dig wildroot and brew it into alpha (a sheaf takes ${dig} to delve, ${brew} to brew). Start here.`, [14, 15]],
      ['Mana', 'Feed alpha in and they pour mana for more beasts.', [20, 21, 22]],
      ['Guard your hold', 'Raise your ward so raiders chant longer to break in.', [16, 17, 18, 19]],
      ['Beasts of war', 'They ride with your Wyrm to raid, and stand to defend.', [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]],
    ];
    const card = (t: (typeof STRUCT_TYPES)[number]) => {
      const limit = t.buildLimit && owned(p, t.id) >= t.buildLimit;
      const circle = freeCircle(p, t);
      const why = limit ? 'Only one may be bound to a warden.' : !circle ? 'No free circle in a realm it can stand in.' : buildBlock(p, t);
      const L = lore(t.id), hallow = t.category === 'planet';
      const realms = REALMS.filter((r) => t.possibleAmbit & { starfall: 16, skies: 8, wilds: 4, deeps: 2 }[r]);
      return h('button', { type: 'button', class: 'card-btn' + (t.id === next ? ' rec' : ''), disabled: !!why, onclick: () => {
        veil.remove();
        rite(p, () => act.build(p, t, circle!.ambit as Ambit, circle!.slot));
        toast(`Drawing the circle for the ${L.name}…`, 'player', 2600);
      } },
      h('span', { class: 'row between' }, h('b', null, L.name), t.id === next ? h('span', { class: 'rec-tag' }, 'Start here') : h('span', { class: 'label', style: { color: hallow ? HALLOW_COLOR : REALM_COLOR[realms[0]] } }, hallow ? 'Hallow' : realms.map((r) => REALM_NAME[r]).join(' · '))),
      h('span', { class: 'muted', style: { fontSize: '13px' } }, L.epithet),
      h('span', { class: 'row between', style: { fontSize: '12.5px', color: 'var(--ink-2)' } },
        h('span', { title: 'Mana it drinks while awake', style: { color: 'var(--sky)', fontSize: '13.5px', fontWeight: '700' } }, `${fmtMana(t.buildDraw)} mana`),
        h('span', { title: 'About how long its summoning chant takes to ripen. It ripens even while Wyrmhodl is closed.' }, `${chantTime(t.buildDifficulty)} chant`),
        h('span', { style: { color: ch >= t.buildCharge ? 'var(--verdigris)' : 'var(--root)' } }, `${t.buildCharge} breath`)),
      why ? h('span', { class: 'why' }, retellError(why)) : null);
    };
    for (const [title, line, ids] of GROUPS) {
      const types = ids.map((id) => STRUCT_TYPES.find((t) => t.id === id)).filter((t): t is (typeof STRUCT_TYPES)[number] => !!t && (!only || t.id === only));
      if (!types.length) continue;
      list.append(h('div', { class: 'summon-group' }, h('p', { class: 'label', style: { margin: 0 } }, title), h('p', { class: 'faint', style: { margin: '2px 0 0', fontSize: '13px' } }, line)),
        h('div', { class: 'grid-cards' }, ...types.map(card)));
    }
    const veil = h('div', { class: 'veil', onclick: (e: Event) => { if (e.target === veil) veil.remove(); } },
      h('section', { class: 'scroll wide', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Summon' },
        h('div', { class: 'row between', style: { flexWrap: 'nowrap', alignItems: 'flex-start' } },
          h('div', null, h('h2', null, 'Summon'), h('p', { style: { margin: '4px 0 12px', color: 'var(--muted)' } },
            `Spare mana: ${fmtMana(p.capacity + p.connectionCapacity - p.load - p.structsLoad)} · Breath: ${fmtBreath(ch)}. Each summoning takes its mana the moment the circle is drawn; then its chant ripens, even while Wyrmhodl is closed.`)),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => veil.remove() }, '✕')),
        list));
    returnFocusOnClose(veil);
    document.body.append(veil);
    // keyboard and screen-reader wardens land inside, on the first kind they may summon
    ((veil.querySelector('.card-btn:not(:disabled)') || veil.querySelector('.icon-btn')) as HTMLElement | null)?.focus();
  }

  function feedDialog(p: PlayerState, s: OwnedStruct) {
    const amt = h('input', { id: 'feed-amt', type: 'number', min: '0.001', step: '0.001', value: '1' }) as HTMLInputElement;
    const veil = h('div', { class: 'veil' }, h('section', { class: 'scroll', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Feed alpha' },
      h('h2', null, `Feed the ${beastName(s.typeId)}`),
      h('p', null, `Alpha fed here becomes mana flow for your hold, for good. You hold ${(Number(p.alpha) / 1e6).toLocaleString('en-US')} g.`),
      h('div', { class: 'field' }, h('label', { for: 'feed-amt' }, 'Alpha to feed'), amt),
      h('div', { class: 'row end', style: { marginTop: '16px' } },
        h('button', { type: 'button', class: 'btn ghost', onclick: () => veil.remove() }, 'Not now'),
        h('button', { type: 'button', class: 'btn gold', onclick: () => {
          const g = Number(amt.value);
          if (!(g > 0)) return;
          const u = BigInt(Math.round(g * 1e6));
          if (u > p.alpha) { toast('You do not hold that much alpha.', 'warn'); return; }
          veil.remove(); rite(p, () => act.infuseGenerator(p, s, u), false);
        } }, 'Feed it'))));
    returnFocusOnClose(veil);
    document.body.append(veil);
    amt.focus(); amt.select();
  }

  function guardDialog(p: PlayerState, s: OwnedStruct) {
    const allies = [...p.structs.values()].filter((x) => x.id !== s.id && !x.destroyed && x.built);
    const veil = h('div', { class: 'veil', onclick: (e: Event) => { if (e.target === veil) veil.remove(); } }, h('section', { class: 'scroll', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Guard' },
      h('h2', null, `Whom shall the ${beastName(s.typeId)} guard?`),
      h('p', null, 'A guard steps in front of blows aimed at its ward, when it can reach them.'),
      h('div', { class: 'stack scroll-y', style: { maxHeight: '50vh' } }, ...allies.map((a) => h('button', { type: 'button', class: 'choice', onclick: () => { veil.remove(); rite(p, () => act.defend(p, s, a.id)); } },
        // several of a kind are told apart by number, never by their ledger mark
        h('span', null, beastName(a.typeId) + (allies.filter((x) => x.typeId === a.typeId).length > 1 ? ` ${allies.filter((x) => x.typeId === a.typeId).indexOf(a) + 1}` : ''), h('small', null, a.type?.category === 'planet' ? 'Hallow' : REALM_NAME[realmOf(a)])), h('span', { class: 'hearts', role: 'img', 'aria-label': `vigor ${a.health} of ${a.type?.maxHealth || 0}` }, hearts(a.health, a.type?.maxHealth || 0)))))));
    returnFocusOnClose(veil);
    document.body.append(veil);
    (veil.querySelector('.choice') as HTMLElement | null)?.focus();
  }

  function paintBanner(p: PlayerState | null) {
    clear(banner);
    if (watching) banner.append(h('div', { class: 'glass row', style: { alignSelf: 'center', padding: '8px 16px', borderRadius: '999px', margin: '0 auto', width: 'fit-content' } },
      h('span', { class: 'italic' }, `You are looking at ${p ? playerName(p) : 'another warden'}’s hold`), h('a', { href: '/hold' }, 'Back to your own')));
    else if (!p && wallet.state !== 'empty' && wallet.active?.playerId) {
      // a ledger that stays silent is said plainly, with a way to ask again
      if (Date.now() - readingSince < 15000) banner.append(h('p', { class: 'italic', style: { textAlign: 'center' } }, 'Reading your hold from the ledger…'));
      else banner.append(h('div', { class: 'glass row', role: 'status', style: { alignSelf: 'center', margin: '0 auto', width: 'fit-content', maxWidth: '100%', padding: '8px 10px 8px 16px', borderRadius: '999px', flexWrap: 'wrap' } },
        h('span', null, 'The ledger is not answering yet. Your hold appears the moment it does.'),
        h('button', { type: 'button', class: 'btn small', onclick: () => empire.refresh(ctx.param || wallet.active?.playerId) }, 'Try again')));
    } else if (p?.restored) {
      // painted from the last visit while the ledger is read: say so, and say it plainly if the ledger stays silent
      if (Date.now() - readingSince < 15000) banner.append(h('p', { class: 'italic', style: { textAlign: 'center' } }, 'Reading your hold from the ledger… this is how you left it.'));
      else banner.append(h('div', { class: 'glass row', role: 'status', style: { alignSelf: 'center', margin: '0 auto', width: 'fit-content', maxWidth: '100%', padding: '8px 10px 8px 16px', borderRadius: '999px', flexWrap: 'wrap' } },
        h('span', null, 'The ledger is not answering yet. This is your hold as you left it; your rites wait until it answers.'),
        h('button', { type: 'button', class: 'btn small', onclick: () => empire.refresh(p.playerId) }, 'Try again')));
    }
  }

  /** Keep the isle centred in the open sky between the panels, not behind the right-hand card. */
  function reframe() {
    const ctl = scene.get();
    if (!ctl || !canvas.isConnected) return;
    if (!matchMedia('(min-width: 721px)').matches) { ctl.frame(0); return; }
    const c = canvas.getBoundingClientRect();
    const left = (el.querySelector('.cols > .col-l') as HTMLElement | null)?.getBoundingClientRect();
    const rightCol = el.querySelector('.cols > .col-r') as HTMLElement | null;
    const right = rightCol && [...rightCol.children].some((k) => !(k as HTMLElement).hidden && (k as HTMLElement).offsetHeight > 0) ? rightCol.getBoundingClientRect() : null;
    const l = left && left.width ? left.right : c.left, r = right && right.width ? right.left : c.right;
    ctl.frame(Math.max(-c.width / 4, Math.min(c.width / 4, (l + r) / 2 - (c.left + c.width / 2))));
  }
  // the Stage resizes on its own observer: reframe after it has, two frames on
  const onResize = () => requestAnimationFrame(() => requestAnimationFrame(reframe));
  window.addEventListener('resize', onResize);

  let toured = false;
  /** Whose beasts stand on the isle and whose rites the Chronicle tells. */
  let shownFor: string | null = null;
  function paint() {
    trackReading();
    const p = player();
    // a warden gone (forgotten here or in another tab) or switched: the isle goes back to a stranger's, bare and
    // unwarded, the choice is let go, and whoever comes next is set down quietly, as on a first look
    if ((p?.playerId ?? null) !== shownFor) {
      if (shownFor) {
        sel = null; raiders = []; raidCheckAt = 0; first = true;
        const isle = scene.get();
        if (isle) { isle.sync([], true); isle.setWard(0); }
      }
      shownFor = p?.playerId ?? null;
      chron.repaint();
    }
    checkRaiders();
    keepFocus(el, () => { paintBanner(p); paintOmens(p); paintRoster(p); paintCard(p); paintRites(p); });
    // a warden's first time in their own Hold: a short look around, once the isle has woken
    if (!toured && p && !watching && empire.commands(p.playerId)) {
      toured = true;
      let later = false; try { later = sessionStorage.getItem('wyrmhold.hatch') === '1'; } catch { /* ignore */ }
      setTimeout(() => { if (canvas.isConnected && !document.querySelector('.veil, .prologue')) holdTour(); }, later ? 7000 : 2600);
    }
    const ctl = scene.get();
    if (ctl && p) {
      // fresh from the oath: the first sight of the isle is the Wyrm hatching, not a still life
      let hatch = false;
      if (first && !watching) { try { hatch = sessionStorage.getItem('wyrmhold.hatch') === '1'; sessionStorage.removeItem('wyrmhold.hatch'); } catch { hatch = false; } }
      // each unit carries its name, so the isle can label what stands on it
      const named = unitsOf(p).map((u) => ({ ...u, label: beastName(u.type) + (u.building ? ' · summoning' : u.offline ? ' · slumbering' : '') }));
      ctl.sync(named, first && !hatch);
      requestAnimationFrame(reframe);
      if (hatch) setTimeout(() => proclaim('Your Elder Wyrm hatches', 'Bound to you alone. Every raid you ride, you ride on its back.', 'gold'), 1800);
      first = false;
      const shield = num(p.planet?.planetAttributes?.planetaryShield);
      ctl.setWard(Math.min(1.4, shield / 125));
    }
  }

  // When a rite of this hold lands, the isle answers.
  const onLanded = txq.onSettled((j) => {
    const p = player();
    if (j.status !== 'success' || !p || j.playerId !== p.playerId) return;
    const urls = j.msgs.map((m) => m.typeUrl).join();
    const ctl = scene.get();
    if (!ctl) return;
    if (/OreMinerComplete/.test(urls)) ctl.rite('delve');
    if (/OreRefineryComplete/.test(urls)) ctl.rite('brew');
    if (/GeneratorInfuse/.test(urls)) ctl.rite('tithe');
    if (/PlanetExplore/.test(urls)) ctl.rite('seek');
    if (/DefenseSet|StealthActivate/.test(urls)) ctl.rite('ward');
  });
  const offs = [empire.onChange(paint), wallet.onChange(paint), live.onBlock(() => { /* breath ticks */ }), onLanded, () => clearTimeout(slowCheck)];
  paint();

  return {
    el, title: watching ? 'Watching a hold' : 'The Hold',
    leave: () => { window.removeEventListener('resize', onResize); offs.forEach((f) => f()); watching$.forEach((f) => f()); pendingClaims.forEach(releaseClaim); scene.dispose(); tip.dispose(); bar.dispose(); chants.dispose(); chron.dispose(); if (watching) empire.unwatch(watching); document.querySelectorAll('.veil').forEach((v) => v.remove()); },
  };
}

