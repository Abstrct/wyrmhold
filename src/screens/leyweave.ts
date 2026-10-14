/* The Leyweave: where alpha becomes mana. Every coven's wellspring, the ley shrine your hold drinks
 * from, and your own tithes — all read live. Tithing and unbinding seal real rites. */
import { h, clear, toast, confirmBox, keepFocus } from '../core/dom';
import K from '../world/wyrmkit.js';
import { mountScene, type Ctx, type Screen } from './types';
import { topbar } from '../ui/frame';
import { chroniclePanel } from '../ui/chants';
import { lcd, big, type Grid, type RawInfusion, type RawReactor } from '../chain/lcd';
import { guilds, type GuildEntry } from '../guild/directory';
import { guildList } from '../guild/api';
import { empire, type PlayerState } from '../game/empire';
import { wallet } from '../wallet/wallet';
import { txq } from '../wallet/queue';
import { covenColor, covenName, fmtAlpha, fmtMana, speak } from '../lore';

interface Well { r: RawReactor; grid: Grid; commission: number }

const M = (name: string, value: Record<string, unknown>) => ({ typeUrl: `/structs.structs.${name}`, value });

interface Weave { rs: RawReactor[]; grids: Grid[]; inf: RawInfusion[]; sub: Grid | null }
type GridRow = { object_id: string; attribute_type: string; val: string };

/** The whole weave from the coven's Guild API: every wellspring and its grid in four reads (the
 * ledger node needs one per wellspring), and only this warden's tithes (the node can only list
 * every tithe on the ledger). Null when the API can't answer. */
async function weaveFromGuild(p: PlayerState | null): Promise<Weave | null> {
  const grid = (attr: keyof Grid) => guildList<GridRow>(`grid/attribute-type/${attr}/object-type/reactor`);
  const [rows, fuel, capacity, power, inf, sub] = await Promise.all([
    guildList<{ id: string; validator: string; guild_id: string; default_commission: string; owner: string }>('reactor/all'),
    grid('fuel'), grid('capacity'), grid('power'),
    p ? guildList<{ destination_type: string; destination_id: string; fuel_p: string; power_p: string; commission: string; player_id: string; address: string; ratio_p: string; defusing_p: string }>(`infusion/list/address/${encodeURIComponent(p.address)}`) : Promise.resolve([]),
    p?.substationId ? guildList<GridRow>(`grid/object/${encodeURIComponent(p.substationId)}`) : Promise.resolve([]),
  ]);
  if (!rows || !fuel || !capacity || !power || !inf || !sub) return null;
  const byReactor = new Map<string, Grid>();
  for (const [attr, list] of [['fuel', fuel], ['capacity', capacity], ['power', power]] as const) {
    for (const g of list) { const x = byReactor.get(g.object_id) ?? {}; x[attr] = String(g.val); byReactor.set(g.object_id, x); }
  }
  const shrine: Grid = {};
  for (const g of sub) (shrine as Record<string, string>)[g.attribute_type] = String(g.val);
  return {
    rs: rows.map((r) => ({ id: r.id, validator: r.validator, guildId: r.guild_id, defaultCommission: String(r.default_commission ?? '0'), owner: r.owner })),
    grids: rows.map((r) => byReactor.get(r.id) ?? {}),
    inf: inf.map((i) => ({ destinationType: i.destination_type, destinationId: i.destination_id, fuel: String(i.fuel_p ?? '0'), power: String(i.power_p ?? '0'),
      commission: String(i.commission ?? '0'), playerId: i.player_id, address: i.address, ratio: String(i.ratio_p ?? '0'), defusing: String(i.defusing_p ?? '0') })),
    sub: p?.substationId ? shrine : null,
  };
}

/** The same from the ledger node. */
async function weaveFromLedger(p: PlayerState | null): Promise<Weave> {
  const [rs, inf, sub] = await Promise.all([
    lcd.list<RawReactor>('reactor', 'Reactor'),
    p ? lcd.list<RawInfusion>('infusion', 'Infusion').catch(() => [] as RawInfusion[]) : Promise.resolve([] as RawInfusion[]),
    p?.substationId ? lcd.entity<{ gridAttributes?: Grid }>('substation', p.substationId).then((r) => r.gridAttributes || {}).catch(() => null) : Promise.resolve(null),
  ]);
  const grids = await Promise.all(rs.map((r) => lcd.entity<{ gridAttributes?: Grid }>('reactor', r.id).then((x) => x.gridAttributes || {}).catch(() => ({} as Grid))));
  return { rs, grids, inf, sub };
}

export function leyweave(ctx: Ctx): Screen {
  const canvas = h('canvas');
  const bar = topbar('#/leyweave', ctx.oath, { meters: true });
  const mine = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' } });
  const wellsBox = h('div', { class: 'grid-cards' });
  const chron = chroniclePanel((j) => /Reactor|GeneratorInfuse/.test(j.msgs.map((m) => m.typeUrl).join()), 10);
  const el = h('div', { class: 'screen scrolls', style: { background: '#0a0b1e' } },
    h('section', { style: { position: 'relative', height: '52vh', minHeight: '360px', overflow: 'hidden' } },
      h('div', { class: 'stage' }, canvas),
      h('div', { class: 'hud', style: { height: 'auto' } }, bar.el),
      h('p', { style: { position: 'absolute', left: 'clamp(16px, 3vw, 32px)', bottom: '14px', margin: 0, maxWidth: '620px', fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 'clamp(18px, 2vw, 24px)', color: 'var(--gold-hi)', textShadow: '0 2px 20px rgba(0,0,0,.8)', zIndex: 3 } },
        'Alpha tithed to a wellspring wakes as mana. The leylines carry it to the shrines, and every hold that drinks there feels it.')),
    h('main', { class: 'ley-main', style: { maxWidth: '1280px', margin: '0 auto', padding: '26px clamp(16px, 3vw, 32px) 64px' } },
      h('h2', { class: 'display', style: { fontSize: '32px' } }, 'Your leyweave'), h('div', { style: { marginTop: '14px' } }, mine),
      h('div', { class: 'row between', style: { marginTop: '44px', alignItems: 'baseline' } },
        h('h2', { class: 'display', style: { fontSize: '32px' } }, 'The wellsprings'),
        h('span', { class: 'muted', style: { fontSize: '14px' } }, 'Every coven keeps one. A wellspring keeps a little of each tithe as its due.')),
      h('div', { style: { marginTop: '14px' } }, wellsBox),
      h('div', { style: { marginTop: '24px', maxWidth: '640px' } }, chron.el)));

  const scene = mountScene(canvas, (c) => K.leyweave(c, {}));
  let wells: Well[] = [];
  let tithes: RawInfusion[] = [];
  let shrine: Grid | null = null;
  let covens = new Map<string, GuildEntry>();
  let loaded = false;
  let failed = false;
  let again = () => {};

  const name = (gid: string) => covenName(gid, covens.get(gid)?.meta?.name);

  let left = false, retry = 0, gen = 0, shrineLater = 0;
  async function load() {
    const g = ++gen;
    const p = empire.commander;
    const [{ rs, grids, inf, sub }, gs] = await Promise.all([
      weaveFromGuild(p).then((w) => w ?? weaveFromLedger(p)),
      guilds().catch(() => [] as GuildEntry[]),
    ]);
    // a screen already left, or a newer read under way, keeps what it has
    if (left || g !== gen) return;
    covens = new Map(gs.map((c) => [c.id, c]));
    wells = rs.map((r, i) => ({ r, grid: grids[i], commission: Number(r.defaultCommission || 0) })).sort((a, b) => Number(big(b.grid.fuel) - big(a.grid.fuel)));
    tithes = p ? inf.filter((i) => i.address === p.address && i.destinationType === 'reactor') : [];
    shrine = sub;
    loaded = true;
    paint();
  }

  function guard(): boolean {
    if (!empire.commander) { toast('Swear the oath first.', 'warn', 5000, { label: 'Oath', run: ctx.oath }); return false; }
    if (!wallet.unlocked) { toast('Your soulstone is sealed.', 'warn', 5000, { label: 'Unseal', run: ctx.oath }); return false; }
    return true;
  }

  function titheDialog(w: Well, unbind = false) {
    const p = empire.commander;
    if (!guard() || !p) return;
    const staked = big(tithes.find((t) => t.destinationId === w.r.id)?.fuel);
    const max = unbind ? staked : p.alpha;
    // Nothing to give yet: say how to get some, instead of offering an empty rite.
    if (!unbind && max <= 0n) {
      const none = h('div', { class: 'veil', onclick: (e: Event) => { if (e.target === none) none.remove(); } }, h('section', { class: 'scroll', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Tithe' },
        h('h2', null, `Tithe to ${name(w.r.guildId)}`),
        h('p', null, 'You hold no alpha yet. Alpha comes from wildroot: a Root Delver digs it up, and a Dawn Cauldron brews it into alpha. Come back once your Cauldron has brewed some.'),
        h('div', { class: 'row end', style: { marginTop: '16px' } },
          h('button', { type: 'button', class: 'btn ghost', onclick: () => none.remove() }, 'Close'),
          h('a', { class: 'btn gold', href: '#/hold', onclick: () => none.remove() }, 'Go to my Hold'))));
      document.body.append(none);
      return;
    }
    const amt = h('input', { id: 'tithe-amt', type: 'number', min: '0.000001', step: '0.1', value: '1' }) as HTMLInputElement;
    const preview = h('p', { class: 'muted', style: { minHeight: '22px', fontSize: '14px' } });
    const upd = () => {
      const u = BigInt(Math.max(0, Math.round(Number(amt.value || 0) * 1e6)));
      const yours = BigInt(Math.round(Number(u) * (1 - w.commission)));
      preview.textContent = u > max ? `You ${unbind ? 'have tithed' : 'hold'} only ${fmtAlpha(max)} α here.` : unbind ? `Your mana flow falls by about ${fmtMana(yours)}. The alpha returns over many days.` : `About +${fmtMana(yours)} mana flow for your hold; the wellspring keeps ${(w.commission * 100).toFixed(0)}% as its due.`;
    };
    amt.addEventListener('input', upd); upd();
    const veil = h('div', { class: 'veil', onclick: (e: Event) => { if (e.target === veil) veil.remove(); } }, h('section', { class: 'scroll', role: 'dialog', 'aria-modal': 'true', 'aria-label': unbind ? 'Unbind' : 'Tithe' },
      h('h2', null, unbind ? `Unbind from ${name(w.r.guildId)}` : `Tithe to ${name(w.r.guildId)}`),
      h('p', null, unbind ? 'Drawing a tithe back takes many days; your mana flow falls at once.' : `You hold ${fmtAlpha(p.alpha)} α. A tithe stays yours — you can unbind it later — and wakes as mana while it rests in the wellspring.`),
      h('div', { class: 'field' }, h('label', { for: 'tithe-amt' }, 'Alpha'), amt), preview,
      h('div', { class: 'row end' },
        h('button', { type: 'button', class: 'btn ghost', onclick: () => veil.remove() }, 'Not now'),
        h('button', { type: 'button', class: unbind ? 'btn ember' : 'btn gold', onclick: async () => {
          const u = BigInt(Math.round(Number(amt.value || 0) * 1e6));
          if (u <= 0n || u > max) return;
          if (unbind && !(await confirmBox('Unbind this tithe?', `${fmtAlpha(u)} α leaves the wellspring over many days, and your mana flow falls now. If your beasts drink more than you keep, they will slumber.`, 'Unbind'))) return;
          veil.remove();
          try {
            const job = txq.enqueue(M(unbind ? 'MsgReactorDefuse' : 'MsgReactorInfuse', { delegator_address: p.address, validator_address: w.r.validator, amount: { denom: 'ualpha', amount: u.toString() } }),
              { account: p.account, playerId: p.playerId, label: `${unbind ? 'Unbind' : 'Tithe'} ${fmtAlpha(u)} alpha ${unbind ? 'from' : 'to'} the wellspring of ${name(w.r.guildId)}`, source: 'you' });
            if (!unbind) scene.get()?.tithe();
            toast(unbind ? 'The unbinding begins.' : 'Your alpha sinks into the wellspring.', 'player');
            // the moment the tithe lands, read the wellsprings again so "Your tithes" says so
            // (a failed tithe can be tried again from its toast under the same id, so keep listening until it lands)
            const off = txq.onSettled((j) => {
              if (j.id !== job.id || j.status === 'failed') return;
              off();
              if (j.status === 'success' && !left) setTimeout(() => { if (!left) load().catch(() => { /* the next look will tell */ }); }, 1200);
            });
            offs.push(off);
          } catch (e) { toast(speak((e as Error).message), 'enemy'); }
        } }, unbind ? 'Unbind' : 'Tithe'))));
    document.body.append(veil);
  }

  function card(title: string, eyebrow: string, color: string, body: (Node | string)[]) {
    return h('section', { class: 'glass panel', style: { padding: '18px' } },
      h('p', { class: 'eyebrow', style: { color } }, eyebrow), h('h3', { class: 'display' + (/^[\d.]/.test(title) ? ' num' : ''), style: { fontSize: '26px', marginTop: '6px' } }, title), ...body);
  }

  // the page rebuilds as the ledger moves (every read of your warden): each part repaints only when
  // what it says has changed, and keyboard focus survives it
  const sigs: Record<string, string> = {};
  /** One section repaints only when what it says has changed. */
  const changed = (k: string, sig: string) => { if (sigs[k] === sig) return false; sigs[k] = sig; return true; };

  let reread = false;
  function paint() { if (!left) keepFocus(el, paintNow); }
  function paintNow() {
    const p = empire.commander;
    // the page can open before the warden is read: read the shrine again once they are
    if (p?.substationId && loaded && !shrine && !reread) {
      reread = true;
      // ask once now; if the shrine is still silent, ask again a little later rather than never
      const later = () => { if (left) return; clearTimeout(shrineLater); shrineLater = window.setTimeout(() => { reread = false; if (!left) paint(); }, 8000); };
      load().then(() => { if (!shrine) later(); }, later);
    }
    paintMine(p);
    paintWells();
  }

  function paintMine(p: PlayerState | null) {
    if (!p) {
      if (changed('mine', 'none')) { clear(mine); mine.append(card('No warden yet', 'Your leyweave', 'var(--violet)', [h('p', { class: 'muted' }, 'Swear the oath: your coven lends you its leyline the moment you are sworn.'), h('button', { type: 'button', class: 'btn gold', onclick: ctx.oath }, 'Swear the oath')])); }
      return;
    }
    const cap = p.capacity + p.connectionCapacity, load = p.load + p.structsLoad;
    const own = covens.get(p.guildId)?.chain?.primaryReactorId;
    const tithed = tithes.reduce((a, t) => a + big(t.fuel), 0n);
    const ctl = scene.get();
    if (ctl) ctl.setRate(cap > 0n ? 0.4 + Math.min(2.6, Number(load * 100n / cap) / 40) : 0.2);
    if (!changed('mine', JSON.stringify([String(cap), String(load), p.online, !!p.substationId, shrine && [shrine.connectionCount, shrine.connectionCapacity], String(tithed), tithes.length, !!own]))) return;
    clear(mine);
    mine.append(
      card(cap >= load ? `${fmtMana(cap - load)} spare` : `${fmtMana(load - cap)} short`, 'Mana flow', 'var(--sky)', [h('p', { class: 'muted', style: { margin: '8px 0 0' } }, p.online ? `Your beasts drink ${fmtMana(load)}; your leylines pour up to ${fmtMana(cap)}. ${fmtMana(cap - load)} is spare for new summonings.` : 'Your beasts drink more than you pour: they slumber until it fits.'),
        h('span', { class: 'bar', style: { marginTop: '10px' } }, h('i', { style: { width: (cap > 0n ? Math.max(0, 100 - Math.min(100, Number(load * 100n / cap))) : 0) + '%', background: p.online ? 'var(--sky)' : 'var(--ember)' } }))]),
      card(p.substationId ? 'Your coven’s shrine' : 'No shrine', 'Ley shrine', 'var(--verdigris)', [h('p', { class: 'muted', style: { margin: '8px 0 0' } },
        shrine ? `${shrine.connectionCount || '0'} holds drink here, each granted up to ${fmtMana(big(shrine.connectionCapacity))} mana.` : p.substationId ? 'Your hold drinks from it. Reading how many share it…' : 'Your hold drinks from no shrine.')]),
      card(`${fmtAlpha(tithed)} α`, 'Your tithes', 'var(--gold)', [h('p', { class: 'muted', style: { margin: '8px 0 0' } }, tithes.length ? `Resting in ${tithes.length} wellspring${tithes.length === 1 ? '' : 's'}.` : 'You have tithed nothing yet.'),
        own ? h('p', { class: 'faint', style: { fontSize: '13px', margin: '6px 0 0' } }, 'Tithe to your coven’s wellspring below to raise your flow.') : '']),
    );
  }

  function paintWells() {
    const me = empire.commander;
    const ourWell = me ? covens.get(me.guildId)?.chain?.primaryReactorId : undefined;
    const state = !loaded ? 'listening' : failed && !wells.length ? 'silent' : 'wells';
    // your warden is read again every few bells; the wells only change when the wellsprings or your tithes do
    const sig = JSON.stringify([state, !!me, ourWell, wells.map((w) => [w.r.id, w.r.guildId, w.r.validator, name(w.r.guildId), String(big(w.grid.fuel)), w.commission, String(big(w.grid.capacity) || big(w.grid.power)), String(big(tithes.find((t) => t.destinationId === w.r.id)?.fuel))])]);
    if (!changed('wells', sig)) return;
    clear(wellsBox);
    if (state === 'listening') { wellsBox.append(h('p', { class: 'italic' }, 'Listening to the wellsprings…')); return; }
    if (state === 'silent') { wellsBox.append(h('p', { class: 'muted' }, 'The wellsprings are not answering just now. ', h('button', { type: 'button', class: 'linkish', onclick: () => again() }, 'Try again'))); return; }
    for (const w of wells) {
      const color = covenColor(w.r.guildId);
      const mineHere = tithes.find((t) => t.destinationId === w.r.id);
      const ours = ourWell === w.r.id;
      wellsBox.append(h('div', { class: 'card-btn', style: { cursor: 'default', borderColor: ours ? 'rgba(232,200,114,.6)' : undefined } },
        h('span', { class: 'row between' }, h('b', null, name(w.r.guildId)), h('span', { class: 'gem', style: { background: color, boxShadow: `0 0 10px ${color}` } })),
        ours ? h('span', { style: { fontSize: '12.5px', color: 'var(--gold)' } }, 'Your coven’s wellspring') : '',
        h('span', { class: 'row between mono', style: { fontSize: '13px', color: 'var(--ink-2)' } },
          h('span', null, `${fmtAlpha(big(w.grid.fuel))} α resting`), h('span', null, `${(w.commission * 100).toFixed(0)}% due`)),
        h('span', { class: 'mono', style: { fontSize: '13px', color: 'var(--sky)' } }, `${fmtMana(big(w.grid.capacity) || big(w.grid.power))} mana poured`),
        mineHere ? h('span', { style: { fontSize: '13px', color: 'var(--gold)' } }, `Your tithe: ${fmtAlpha(big(mineHere.fuel))} α`) : '',
        h('span', { class: 'row', style: { marginTop: '4px' } },
          h('button', { type: 'button', class: 'btn small gold', 'data-key': 'tithe:' + w.r.id, 'data-tut': ours || (!me && w === wells[0]) ? 'tithe' : null, 'aria-label': `Tithe to ${name(w.r.guildId)}`, onclick: () => titheDialog(w) }, 'Tithe'),
          mineHere ? h('button', { type: 'button', class: 'btn small ghost', 'data-key': 'unbind:' + w.r.id, 'aria-label': `Unbind your tithe from ${name(w.r.guildId)}`, onclick: () => titheDialog(w, true) }, 'Unbind') : '')));
    }
  }

  const offs = [empire.onChange(paint)];
  paint();
  // if the wellsprings are silent, say so and keep asking quietly until they answer
  const read = (): void => { load().then(() => { failed = false; clearTimeout(retry); if (!left) paint(); }, () => { if (left) return; loaded = true; failed = true; paint(); clearTimeout(retry); retry = window.setTimeout(read, 8000); }); };
  again = () => { clearTimeout(retry); loaded = false; paint(); read(); };
  read();
  return { el, title: 'Leyweave', leave: () => { left = true; clearTimeout(retry); clearTimeout(shrineLater); offs.forEach((f) => f()); scene.dispose(); bar.dispose(); chron.dispose(); document.querySelectorAll('.veil').forEach((v) => v.remove()); } };
}
