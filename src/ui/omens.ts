/* Omens of war: the sky tells you when a plunder lands — yours on another hold, or another
 * warden's on yours. Read straight from the ledger's raid and theft events as each bell is struck. */
import { live, type ChainTxEvent } from '../chain/live';
import { empire } from '../game/empire';
import { wallet } from '../wallet/wallet';
import { toast, h } from '../core/dom';
import { audio } from '../core/audio';
import { playerName } from '../realm';

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

/** A great banner across the sky for the moments that matter. */
export function proclaim(title: string, line: string, tone: 'gold' | 'ember') {
  const el = h('div', { class: `proclaim ${tone}`, role: 'status', 'aria-live': 'assertive' }, h('p', { class: 'proclaim-title' }, title), h('p', { class: 'proclaim-line' }, line));
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('on'));
  setTimeout(() => { el.classList.remove('on'); setTimeout(() => el.remove(), 900); }, 5200);
}

/** Screens that want to know when one of our raids lands (the Skirmish shows a won state). */
const plunderL = new Set<(d: { planetId?: string; seized: number }) => void>();
export function onPlunder(f: (d: { planetId?: string; seized: number }) => void) { plunderL.add(f); return () => { plunderL.delete(f); }; }

export function watchOmens() {
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
