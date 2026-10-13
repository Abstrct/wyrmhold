/* Omens of war: the sky tells you when a plunder lands — yours on another hold, or another
 * warden's on yours. Read straight from the ledger's raid and theft events as each bell is struck. */
import { live, type ChainTxEvent } from '../chain/live';
import { empire } from '../game/empire';
import { wallet } from '../wallet/wallet';
import { toast, h } from '../core/dom';
import { audio } from '../core/audio';
import { playerName } from '../realm';
import { BEASTS } from '../lore';
import { typeOf } from '../data/catalogue';

interface RaidDetail { fleetId?: string; planetId?: string; status?: string; seized_ore?: string; seizedOre?: string }
interface TheftDetail { victimPlayerId?: string; thiefPlayerId?: string; amount?: string }

const unwrap = (e: ChainTxEvent, key: string) => (e.data && typeof e.data === 'object' && key in e.data ? e.data[key] : e.data);
const seen = new Set<string>();

function mine() {
  const ids = new Set(wallet.playerIds());
  const planets = new Set<string>(), fleets = new Set<string>();
  for (const p of empire.players.values()) if (ids.has(p.playerId)) { if (p.planetId) planets.add(p.planetId); if (p.fleetId) fleets.add(p.fleetId); }
  return { ids, planets, fleets };
}

/** An isle by its warden's name. */
function isleOf(planetId?: string) { for (const p of empire.players.values()) if (planetId && p.planetId === planetId) return `${playerName(p)}’s isle`; return 'their isle'; }

/** A great banner across the sky for the moments that matter. Banners never stack: one that comes while
 * another is up waits its turn, and cuts the one before it short (but never before it can be read). */
const banners: [string, string, 'gold' | 'ember'][] = [];
let showing: { el: HTMLElement; at: number; timer: number } | null = null;
export function proclaim(title: string, line: string, tone: 'gold' | 'ember') {
  banners.push([title, line, tone]);
  if (!showing) nextBanner();
  else { clearTimeout(showing.timer); const s = showing; s.timer = window.setTimeout(() => endBanner(s.el), Math.max(0, s.at + 2400 - Date.now())); }
}
function nextBanner() {
  const b = banners.shift();
  if (!b) { showing = null; return; }
  const [title, line, tone] = b;
  const el = h('div', { class: `proclaim ${tone}`, role: 'status', 'aria-live': 'assertive' }, h('p', { class: 'proclaim-title' }, title), h('p', { class: 'proclaim-line' }, line));
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('on'));
  showing = { el, at: Date.now(), timer: window.setTimeout(() => endBanner(el), banners.length ? 2400 : 5200) };
}
function endBanner(el: HTMLElement) {
  el.classList.remove('on');
  setTimeout(() => { el.remove(); nextBanner(); }, 700);
}
/** Screens that want to know when one of our raids lands (the Skirmish shows a won state). */
const plunderL = new Set<(d: { planetId?: string; seized: number }) => void>();
export function onPlunder(f: (d: { planetId?: string; seized: number }) => void) { plunderL.add(f); return () => { plunderL.delete(f); }; }

/** Blows against your beasts while you are elsewhere: one herald at a time, with a way to the fight. */
let lastStruck = 0;
function struckElsewhere(events: ChainTxEvent[]) {
  if (document.body.dataset.route === 'skirmish' || Date.now() - lastStruck < 15000) return;
  const { ids } = mine();
  for (const e of events) {
    if (e.type !== 'EventAttack') continue;
    const d = unwrap(e, 'eventAttackDetail') as { attackerPlayerId?: string; attackerStructType?: string; eventAttackShotDetail?: { targetPlayerId?: string; targetStructType?: string; targetDestroyed?: boolean; evaded?: boolean }[] };
    const shot = (d?.eventAttackShotDetail || []).find((s) => s.targetPlayerId && ids.has(s.targetPlayerId));
    if (!shot || !d.attackerPlayerId || ids.has(d.attackerPlayerId)) continue;
    lastStruck = Date.now();
    const foe = empire.players.get(d.attackerPlayerId);
    const by = foe ? `${playerName(foe)}’s warband` : 'A raider';
    const what = beastWord(shot.targetStructType);
    toast(shot.targetDestroyed ? `${by} felled your ${what}!` : `${by} strikes your ${what}${shot.evaded ? ', and misses' : ''}.`, 'enemy', 8000, { label: 'Defend', run: () => { location.hash = `#/skirmish/${d.attackerPlayerId}`; } });
    return;
  }
}
/** The ledger's name for a beast, said in the realm's tongue. */
const beastWord = (ledgerType?: string) => { for (const [id, l] of Object.entries(BEASTS)) if (typeOf(Number(id))?.type === ledgerType) return l.name; return 'beast'; };

export function watchOmens() {
  live.onTx((tx) => struckElsewhere(tx.events));
  live.onTx((tx) => {
    const raid = tx.events.find((e) => e.type === 'EventRaid');
    if (!raid) return;
    const d = unwrap(raid, 'eventRaidDetail') as RaidDetail;
    // The live feed can deliver one rite twice (block and tx streams): know a raid by what it was.
    const key = `${d.fleetId}|${d.planetId}|${d.status}|${tx.height}`;
    if (seen.has(key)) return;
    seen.add(key);
    const theft = tx.events.find((e) => e.type === 'EventOreTheft');
    const t = theft ? (unwrap(theft, 'eventOreTheftDetail') as TheftDetail) : null;
    const seized = Number(d.seized_ore ?? d.seizedOre ?? t?.amount ?? 0);
    const { ids, planets, fleets } = mine();
    const sheaves = `${seized} ${seized === 1 ? 'sheaf' : 'sheaves'} of wildroot`;
    if (d.status === 'raidSuccessful' && d.fleetId && fleets.has(d.fleetId)) {
      audio.bell(523.25, 0.2, 3); setTimeout(() => audio.bell(783.99, 0.16, 3), 220); setTimeout(() => audio.bell(1046.5, 0.12, 3), 440);
      for (const f of plunderL) { try { f({ planetId: d.planetId, seized }); } catch (e) { console.error(e); } }
      proclaim('Plundered!', seized > 0 ? `Your warband carries ${sheaves} home from ${isleOf(d.planetId)}.` : `${isleOf(d.planetId).replace(/^t/, 'T')} lies open, but its marrow held nothing unbrewed.`, 'gold');
    } else if (d.status === 'raidSuccessful' && ((d.planetId && planets.has(d.planetId)) || (t?.victimPlayerId && ids.has(t.victimPlayerId)))) {
      audio.stinger('vulnerable', 1);
      proclaim('Your isle was plundered', seized > 0 ? `Raiders carried off ${sheaves}. Brew what you delve — alpha cannot be stolen.` : 'Raiders broke your ward, but found nothing unbrewed to take.', 'ember');
    } else if (d.planetId && planets.has(d.planetId) && d.status && d.status !== 'raidSuccessful') {
      if (d.status === 'attackerDefeated') toast('The raiders’ Elder Wyrm fell over your isle. Their warband flees.', 'player', 6000);
      else if (d.status === 'initiated') toast('A warband has come to plunder your isle. Wake your beasts and strike their Wyrm.', 'enemy', 8000);
    }
  });
}
