/* The Gate: the title vista, the invitation, and the wardens abroad (real players, live). */
import { h } from '../core/dom';
import K from '../world/wyrmkit.js';
import { mountScene, type Ctx, type Screen } from './types';
import { topbar, icon, ICON } from '../ui/frame';
import { wallet } from '../wallet/wallet';
import { wardens, wardenName, playerName } from '../realm';
import { empire } from '../game/empire';
import { playPrologue, prologueSeen } from '../ui/prologue';
import { sheaves } from '../lore';

export function gate(ctx: Ctx): Screen {
  const canvas = h('canvas');
  const bar = topbar(ctx.route, ctx.oath);
  const ticker = h('div', null, h('span', { class: 'italic' }, 'Listening for wardens…'));
  const count = h('span', { class: 'mono faint', style: { fontSize: '12px' } });

  // Until a warden is sworn, the gate's one call is the oath; after, it is home.
  const sworn = () => !!wallet.active?.playerId || wallet.state === 'locked';
  const enter = h('a', { class: 'btn gold', href: '#/hold', 'data-tut': 'begin', style: { minHeight: '52px', padding: '0 28px', fontSize: '18px' },
    onclick: (e: Event) => { if (!sworn()) { e.preventDefault(); ctx.oath(); } } });
  // a returning warden is greeted by name, with the one thing worth knowing before going in
  const welcome = h('p', { class: 'gate-welcome', 'aria-live': 'polite' });
  let said = '';
  const greet = () => {
    const p = empire.commander;
    const head = p && sworn() ? `Welcome back, ${playerName(p)}.` : '';
    const wyrm = p && [...p.structs.values()].some((x) => x.typeId === 1 && !x.destroyed);
    const rest = !head ? '' : (!p!.planetId ? ' Seek your isle at your Hold.' : wyrm ? (p!.fleet?.status === 'away' ? ' Your Elder Wyrm rides abroad; your hold stands unguarded.' : ' Your Elder Wyrm keeps watch.') : ' Your Elder Wyrm has fallen: hatch a new one at your Hold.')
      + (p!.ore > 0 ? ` ${sheaves(p!.ore)} of wildroot ${p!.ore === 1 ? 'waits' : 'wait'} in your stores.` : '');
    // touch the page only when the words change, so a screen reader hears it once
    if (head + rest === said) return;
    said = head + rest;
    welcome.textContent = '';
    if (head) welcome.append(h('b', null, head), rest);
  };
  const label = () => { enter.textContent = ''; enter.append(sworn() ? 'Enter your Hold' : 'Swear the oath', icon(ICON.arrow)); greet(); };
  label();
  const offWallet = wallet.onChange(label);
  const offEmpire = empire.onChange(greet);

  // How a warden plays, in three moves: what the landing page owes a stranger.
  const how = (n: string, k: string, v: string) => h('li', null, h('span', { class: 'n' }, n), h('b', null, k), h('span', null, v));

  const el = h('div', { class: 'screen' },
    h('div', { class: 'stage' }, canvas),
    h('div', { class: 'gate-shade' }),
    h('div', { class: 'hud gate-hud' }, bar.el),
    h('main', { class: 'gate-main' },
      h('p', { class: 'eyebrow rise' }, 'When the sky broke, alpha fell like rain'),
      h('h1', { class: 'gate-title rise', style: { animationDelay: '.15s' } }, 'Wyrmhodl'),
      h('p', { class: 'rise', style: { margin: '22px 0 0', fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 'clamp(22px, 2.6vw, 32px)', animationDelay: '.3s' } }, 'Bind beasts. Brew alpha. Hold the sky.'),
      h('p', { class: 'rise', style: { margin: '18px 0 0', fontSize: '19px', color: '#cfc5dd', maxWidth: '520px', animationDelay: '.45s' } },
        'The shards of the old sky drift above the cloud-sea, and every one is held by a living warden. Alpha — the first light — still seeps through their roots. Raise a wyrm, delve the wildroot, brew it into alpha, and take the sky from those who sleep.'),
      h('div', { class: 'row rise', style: { gap: '14px', marginTop: '34px', animationDelay: '.6s' } }, enter,
        h('a', { class: 'btn', href: '#/grimoire', style: { minHeight: '52px', padding: '0 24px', fontSize: '18px' } }, 'Open the Grimoire')),
      welcome,
      h('ol', { class: 'how rise', style: { animationDelay: '.75s' }, 'aria-label': 'How a warden plays' },
        how('1', 'Raise', 'Summon beasts and hallows on your floating isle.'),
        how('2', 'Brew', 'Dig up wildroot and brew it into alpha, a treasure no one can steal.'),
        how('3', 'Raid', 'Ride out and plunder the isles of wardens who sleep.'))),
    h('footer', { class: 'gate-foot' },
      h('div', { class: 'row', style: { padding: '0 clamp(16px, 4vw, 48px) 10px', gap: '10px' } }, h('span', { class: 'link-dot live' }), h('span', { class: 'eyebrow' }, 'Wardens abroad in the sky'), count,
        h('button', { type: 'button', class: 'btn small ghost', style: { marginLeft: 'auto', minHeight: '32px' }, onclick: () => tell() }, 'Hear the prologue')),
      h('div', { class: 'marquee' }, ticker)));

  const scene = mountScene(canvas, (c) => K.gate(c, {}));
  let tale: { close(): void } | null = null;
  const tell = () => { tale?.close(); tale = playPrologue({ rain: (on) => scene.get()?.rain(on), onOath: ctx.oath }); };
  const auto = !prologueSeen() || ctx.param === 'prologue' ? setTimeout(tell, 400) : 0;
  wardens().then((list) => {
    count.textContent = list.length ? `· ${list.length}` : '';
    const items = list.slice(0, 40).map((w) => h('span', { class: 'row', style: { gap: '8px', flexWrap: 'nowrap' } },
      h('span', { style: { color: 'var(--gold)' } }, '✦'), h('a', { href: `#/hold/${w.id}`, title: `Look at ${wardenName(w)}’s isle`, style: { color: 'inherit', textDecoration: 'none' } }, wardenName(w))));
    ticker.textContent = '';
    for (const it of [...items, ...items.map((n) => n.cloneNode(true))]) ticker.append(it);
  }).catch(() => { ticker.textContent = 'The ledger is quiet just now.'; });

  return { el, title: '', leave: () => { clearTimeout(auto); tale?.close(); scene.dispose(); bar.dispose(); offWallet(); offEmpire(); } };
}
