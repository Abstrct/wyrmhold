/* The Oath: binding a soulstone (the wallet), keeping its soul-words, swearing to a coven (guild
 * signup through the guild's signer) and seeking an isle (MsgPlanetExplore) — and, once sworn, the
 * soulstone itself: its address, its soul-words, and forgetting it. Keys never leave this tab. */
import { h, clear, confirmBox, toast } from '../core/dom';
import { wallet } from '../wallet/wallet';
import { enlist, enlisting, retryEnlist } from '../game/enlist';
import { explore } from '../game/onboard';
import { guilds, guildsNow, DEFAULT_GUILD, type GuildEntry } from '../guild/directory';
import { covenColor, covenName, speak } from '../lore';
import { icon, ICON, sigil } from './frame';
import { empire } from '../game/empire';
import { txq } from '../wallet/queue';
import { claimJob, releaseClaim } from '../core/claims';

let open: HTMLElement | null = null;

const STEPS = ['Soulstone', 'Soul-words', 'Coven', 'Isle'];
const FIRST = ['Ash', 'Bran', 'Cael', 'Dun', 'Eir', 'Fen', 'Gal', 'Hal', 'Isen', 'Kes', 'Lor', 'Mor', 'Nym', 'Oss', 'Ryn', 'Sel', 'Tor', 'Vael', 'Wyn', 'Yr'];
const LAST = ['wen', 'noc', 'ric', 'dra', 'mir', 'eth', 'is', 'an', 'ora', 'ith', 'yn', 'os', 'ael', 'ek'];
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const short = (t: string) => (t.length > 96 ? t.slice(0, 93).replace(/\s+\S*$/, '') + '…' : t);
/** A coven by the name it publishes, when the directory has been read. */
const covenOf = (id: string) => covenName(id, guildsNow()?.find((g) => g.id === id)?.meta?.name);

/** A ring of sparks thrown off the sigil when the oath is sworn. */
function sparks() {
  const burst = h('div', { class: 'path-burst sworn-burst', 'aria-hidden': 'true' });
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2, d = 80 + Math.random() * 110;
    burst.append(h('i', { style: { '--dx': `${Math.cos(a) * d}px`, '--dy': `${Math.sin(a) * d * 0.7}px`, animationDelay: `${120 + Math.random() * 220}ms` } as unknown as Record<string, string> }));
  }
  return burst;
}

/** Why a name won't do, or '' when it will. */
function nameProblem(n: string) {
  if (!n) return 'empty';
  if (/[^A-Za-z0-9_-]/.test(n)) return 'Only letters, digits, - and _';
  if (n.length < 3) return 'At least 3 characters';
  return '';
}

/** `start: 'words'` opens straight onto the soul-words (the top bar's reminder). */
export function openOath(start?: unknown) {
  if (open) return;
  const body = h('div');
  const veil = h('div', { class: 'veil', onclick: (e: Event) => { if (e.target === veil) close(); } },
    h('section', { class: 'scroll', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'oath-title' }, body));
  open = veil;
  document.body.append(veil);
  let offs: (() => unknown)[] = [];
  function close() { offs.forEach((f) => f()); if (seekClaim) releaseClaim(seekClaim); veil.remove(); open = null; document.removeEventListener('keydown', esc); window.removeEventListener('hashchange', close); }
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };

  let mode: 'choose' | 'speak' | 'keep' | 'coven' | 'words' | 'pass' = start === 'words' ? 'words' : 'choose';
  let passNext: 'keep' | 'words' | 'choose' | 'speak' | 'coven' | 'pass' = 'words';
  let name = '';
  let coven = '';
  let covens: GuildEntry[] | null = null;
  let revealed = '';
  let revealing = false;
  let busy = false;
  let sworeHere = false;
  let sparked = false;
  let detailsOpen = false;
  let passTyped = ''; // survives the ledger repainting the dialog mid-typing
  let swearErr = '', speakErr = '', passErr = '';
  let ticked = false;
  let spoken = '';
  let seekClaim = '';   // the isle rite, whose failure this dialog tells while it is open

  const head = (eyebrow: string, title: string) => h('div', { class: 'row between', style: { alignItems: 'flex-start', flexWrap: 'nowrap' } },
    h('div', null, h('p', { class: 'eyebrow' }, eyebrow), h('h2', { id: 'oath-title', style: { marginTop: '6px' } }, title)),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: close }, icon(ICON.close)));

  /** Where this step sits on the road: 0 soulstone, 1 soul-words, 2 coven, 3 isle. */
  const road = (at: number, running = false) => h('ol', { class: 'stepper oath-steps', 'aria-label': 'Steps of the oath' },
    ...STEPS.map((t, i) => h('li', { class: i < at ? 'done' : i === at ? (running ? 'run' : 'now') : '', 'aria-current': i === at ? 'step' : null },
      h('span', { class: 'n' }, i < at ? '✓' : String(i + 1)), h('span', { class: 't' }, t))));

  async function reveal(next: typeof mode, passphrase?: string) {
    if (revealing) return;
    // a passphrase-sealed soulstone asks for it before it speaks its words
    if (!wallet.deviceSealed && passphrase == null) { passNext = next; mode = 'pass'; passErr = ''; queueMicrotask(paint); return; }
    revealing = true;
    try { revealed = await wallet.revealPhrase(passphrase ?? ''); mode = next; passErr = ''; }
    catch (e) { if (mode === 'pass') passErr = speak((e as Error).message); else toast((e as Error).message, 'enemy'); }
    revealing = false; paint();
  }

  /** The twenty-four words, a copy button, and a promise the warden must make before moving on. */
  function wordsPanel(doneLabel: string, onDone: () => void, later?: () => void) {
    const kept = h('input', { type: 'checkbox', id: 'kept', checked: ticked }) as HTMLInputElement;
    const go = h('button', { type: 'button', class: 'btn gold', disabled: !ticked, onclick: () => { ticked = false; wallet.markBackedUp(); onDone(); } }, doneLabel, icon(ICON.arrow, 16)) as HTMLButtonElement;
    kept.onchange = () => { ticked = kept.checked; go.disabled = !ticked; };
    const words = revealed.split(' ');
    return [
      h('p', { style: { marginTop: '14px' } }, `These ${words.length} soul-words are the only way back to your warden if this browser forgets you. Write them down in order, on paper, somewhere safe.`),
      h('div', { class: 'words', 'data-raw': '' }, ...words.map((w, i) => h('span', null, h('i', null, String(i + 1)), w))),
      h('p', { class: 'warn-line' }, icon(ICON.warn, 15), 'Anyone who reads these can take everything. Wyrmhold will never ask for them.'),
      h('div', { class: 'row', style: { marginTop: '10px', gap: '8px' } },
        h('button', { type: 'button', class: 'btn small', onclick: () => {
          navigator.clipboard?.writeText(revealed).then(() => toast('Copied. Paste them somewhere private, then copy something else over them.', 'player', 5000), () => toast('This browser would not copy. Write them by hand.', 'warn'));
        } }, 'Copy the words')),
      h('label', { class: 'check', for: 'kept' }, kept, h('span', null, 'I have written them down somewhere safe')),
      h('div', { class: 'row between', style: { marginTop: '14px' } },
        later ? h('button', { type: 'button', class: 'btn ghost small', onclick: later }, 'Remind me later') : h('span'),
        go),
    ];
  }

  function loadCovens() {
    if (covens) return;
    guilds().then((g) => {
      covens = [...g].sort((a, b) => (b.id === DEFAULT_GUILD ? 1 : 0) - (a.id === DEFAULT_GUILD ? 1 : 0));
      if (!coven && covens.length) coven = covens[0].id;
      paint();
    }).catch(() => { covens = []; paint(); });
  }

  function covenPicker(onPick: () => void) {
    loadCovens();
    if (!covens) return h('p', { class: 'italic' }, 'Reading the covens from the ledger…');
    if (!covens.length) return h('p', { class: 'muted' }, 'No coven answered. The ledger may be quiet — try again in a moment.');
    const list = h('div', { class: 'stack', role: 'radiogroup', 'aria-label': 'Covens' });
    const draw = () => {
      clear(list);
      list.append(...covens!.map((g) => {
        const nm = covenName(g.id, g.meta?.name);
        return h('button', { type: 'button', role: 'radio', 'aria-checked': String(coven === g.id), class: 'choice' + (coven === g.id ? ' on' : ''), onclick: () => { coven = g.id; draw(); onPick(); } },
          h('span', { class: 'row', style: { flexWrap: 'nowrap', minWidth: '0' } }, h('span', { class: 'gem', style: { background: covenColor(g.id), boxShadow: `0 0 12px ${covenColor(g.id)}` } }),
            // each coven's own words about itself, when it has published some
            // shown only when it reads true as written: the word-swapper would garble a coven's own sentence
            h('span', { style: { minWidth: '0' } }, nm, g.meta?.description && speak(g.meta.description) === g.meta.description ? h('small', null, short(g.meta.description)) : '')),
          g.id === DEFAULT_GUILD ? h('span', { class: 'rec' }, 'Good for a first oath') : coven === g.id ? h('span', { style: { color: 'var(--gold)' } }, '✓') : '');
      }));
    };
    draw();
    return list;
  }

  async function swear() {
    const g = covens?.find((c) => c.id === coven);
    if (!g || nameProblem(name)) return;
    busy = true; swearErr = ''; paint();
    try { await enlist(name, g.id, covenName(g.id, g.meta?.name)); sworeHere = true; }
    catch (e) { swearErr = speak((e as Error).message); }
    busy = false; paint();
  }

  // The ledger can repaint this at any moment: keep the caret where the warden left it.
  function paint() {
    const was = document.activeElement;
    const at = was instanceof HTMLInputElement || was instanceof HTMLTextAreaElement ? was : null;
    const keep = at && body.contains(at) && at.id ? { id: at.id, s: at.selectionStart, e: at.selectionEnd } : null;
    draw();
    const back = keep && document.getElementById(keep.id);
    if (back instanceof HTMLInputElement || back instanceof HTMLTextAreaElement) { back.focus(); try { back.setSelectionRange(keep!.s, keep!.e); } catch { /* not a text field */ } }
  }

  function draw() {
    clear(body);
    const a = wallet.active;
    const job = enlisting.current;

    if (mode === 'words' && revealed && wallet.unlocked) {
      body.append(head('Your soulstone', 'Keep your soul-words'),
        ...(wallet.backedUp
          ? [h('div', { class: 'words', 'data-raw': '' }, ...revealed.split(' ').map((w, i) => h('span', null, h('i', null, String(i + 1)), w))),
            h('div', { class: 'row end', style: { marginTop: '16px' } }, h('button', { type: 'button', class: 'btn', onclick: () => { revealed = ''; mode = 'choose'; paint(); } }, 'Hide the soul-words'))]
          : wordsPanel('Done', () => { revealed = ''; mode = 'choose'; paint(); toast('Soul-words kept. Your warden is safe.', 'player'); })));
      return;
    }
    if (mode === 'pass' && wallet.unlocked) {
      const pass = h('input', { type: 'password', id: 'pass-words', autocomplete: 'current-password', value: passTyped, oninput: (e: Event) => { passTyped = (e.target as HTMLInputElement).value; } }) as HTMLInputElement;
      body.append(head('Your soulstone', 'Speak your passphrase'),
        h('p', null, 'Your soul-words are sealed under your passphrase. Speak it to see them.'),
        h('div', { class: 'field' }, h('label', { for: 'pass-words' }, 'Passphrase'), pass),
        passErr ? h('p', { class: 'inline-err', role: 'alert' }, icon(ICON.warn, 15), h('span', null, passErr)) : '',
        h('div', { class: 'row between', style: { marginTop: '16px' } },
          h('button', { type: 'button', class: 'btn ghost', onclick: () => { mode = 'choose'; passErr = ''; passTyped = ''; paint(); } }, 'Back'),
          h('button', { type: 'button', class: 'btn gold', onclick: () => { const v = pass.value; passTyped = ''; void reveal(passNext, v); } }, 'Show the words')));
      return;
    }
    if (mode === 'words' && !revealed && wallet.unlocked) { void reveal('words'); body.append(head('Your soulstone', 'Keep your soul-words'), h('p', { class: 'italic' }, 'Reading the words…')); return; }

    // Sworn in this very dialog: a finish line, not a ledger entry.
    if (sworeHere && (a?.playerId || job?.status === 'done')) {
      const guildName = job?.guildName || covenOf(coven);
      // The scribe writing the warden in is not the isle: that is a rite of its own, a few bells later.
      if (!empire.commander?.planetId) {
        const seek = txq.jobs.filter((j) => a?.playerId && j.playerId === a.playerId && j.msgs.some((m) => /MsgPlanetExplore$/.test(m.typeUrl))).pop();
        const failed = seek?.status === 'failed' ? seek : null;
        if (seek && !failed) claimJob(seekClaim = seek.id);
        body.append(head('The Oath is sworn', failed ? 'No isle yet' : 'Seeking your isle…'),
          road(3, !failed),
          h('p', null, `${job?.name || name}, ${guildName} has written you into the ledger. ` + (failed ? 'But the sky did not give you an isle:' : 'Now the sky is finding you a fresh isle, where your Elder Wyrm will stir. This takes a few moments.')),
          failed ? h('p', { class: 'inline-err', role: 'alert' }, icon(ICON.warn, 15), h('span', null, speak(failed.error || 'the ledger refused'))) : '',
          h('div', { class: 'row end', style: { marginTop: '12px' } }, failed
            // a fresh seek, never the old rite sent again (a warden with no isle has nothing to lose by it)
            ? h('button', { type: 'button', class: 'btn gold', onclick: () => { if (a?.playerId) explore(a.index, a.playerId); } }, 'Seek an isle again')
            : h('button', { type: 'button', class: 'btn ghost small', onclick: close }, 'Look around while it finishes')));
        return;
      }
      body.append(head('The Oath is sworn', 'Your isle awaits'),
        road(4),
        h('div', { class: 'sworn' }, sigil(64)),
        h('p', { style: { textAlign: 'center' } }, `${job?.name || name}, ${guildName} has written you into the ledger. Your Elder Wyrm stirs on a fresh isle, waiting for you.`),
        h('button', { type: 'button', class: 'btn gold block', style: { marginTop: '16px', minHeight: '52px' }, onclick: () => {
          // the Hold plays the hatching for a warden who arrives straight from their oath
          try { sessionStorage.setItem('wyrmhold.hatch', '1'); } catch { /* no ceremony then */ }
          close();
          // already on the Hold: the hash will not change, so ask the router to build it afresh
          if (location.hash === '#/hold') window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = '#/hold';
        } }, 'Enter your Hold', icon(ICON.arrow, 18)),
        !wallet.backedUp ? h('p', { class: 'warn-line', style: { marginTop: '14px' } }, icon(ICON.warn, 15), 'You have not kept your soul-words yet. ',
          h('button', { type: 'button', class: 'linkish', onclick: () => void reveal('words') }, 'Keep them now')) : '');
      // the sparks fly once, from the dialog itself, so the ledger repainting the panel cannot cut them short
      if (!sparked) {
        sparked = true;
        requestAnimationFrame(() => {
          const sg = body.querySelector('.sworn svg'), sec = body.parentElement;
          if (!sg || !sec) return;
          const a2 = sg.getBoundingClientRect(), b2 = sec.getBoundingClientRect(), burst = sparks();
          sec.style.position = 'relative';
          Object.assign(burst.style, { left: `${a2.left - b2.left + a2.width / 2}px`, top: `${a2.top - b2.top + sec.scrollTop + a2.height / 2}px` });
          sec.append(burst);
          setTimeout(() => burst.remove(), 2000);
        });
      }
      return;
    }

    if (job && job.status !== 'done' && !(a?.playerId)) {
      body.append(head('The oath is being sworn', job.status === 'failed' ? 'The oath faltered' : `Welcome, ${job.name}`),
        road(3, job.status !== 'failed'),
        h('p', null, `${job.guildName} is writing you into the ledger and finding you an isle. This takes about a minute, and it carries on if you close this.`),
        h('ol', { class: 'stack', style: { paddingLeft: '20px', color: 'var(--ink-2)' } }, ...job.steps.map((s) => h('li', null, speak(s)))),
        job.status === 'failed'
          ? h('div', { class: 'stack' }, h('p', { style: { color: 'var(--ember-ink)' } }, speak(job.error || '')), h('button', { type: 'button', class: 'btn gold', onclick: () => retryEnlist() }, 'Try the oath again'))
          : h('div', { class: 'row end', style: { marginTop: '12px' } }, h('button', { type: 'button', class: 'btn ghost small', onclick: close }, 'Look around while it finishes')));
      return;
    }

    if (wallet.state === 'locked') {
      const pass = h('input', { type: 'password', id: 'pass', autocomplete: 'current-password', value: passTyped, oninput: (e: Event) => { passTyped = (e.target as HTMLInputElement).value; } }) as HTMLInputElement;
      body.append(head('Your soulstone is sealed', 'Speak the passphrase'),
        h('div', { class: 'field' }, h('label', { for: 'pass' }, 'Passphrase'), pass),
        h('div', { class: 'row end', style: { marginTop: '16px' } }, h('button', { type: 'button', class: 'btn gold', onclick: async () => {
          try { await wallet.unlock(pass.value); passTyped = ''; } catch (e) { toast((e as Error).message, 'enemy'); }
        } }, 'Unseal')));
      return;
    }

    if (wallet.unlocked && a?.playerId) {
      loadCovens(); // for the coven's published name
      body.append(head('Your soulstone', a.label && a.label !== 'Commander' ? a.label : 'Warden'),
        h('dl', { class: 'facts' },
          h('div', null, h('dt', null, 'Coven'), h('dd', null, covenOf(empire.commander?.guildId || ''))),
          h('div', null, h('dt', null, 'Soul-words'), h('dd', { style: { color: wallet.backedUp ? 'var(--verdigris)' : 'var(--ember-ink)' } }, wallet.backedUp ? 'Kept safe' : 'Not kept yet'))),
        h('div', { class: 'row', style: { marginTop: '18px' } },
          h('button', { type: 'button', class: wallet.backedUp ? 'btn' : 'btn gold', onclick: () => void reveal('words') }, wallet.backedUp ? 'Show my soul-words' : 'Keep my soul-words'),
          location.hash === '#/hold' ? null : h('a', { class: 'btn ghost', href: '#/hold', onclick: close }, 'Go to my Hold')),
        h('details', { class: 'more', open: detailsOpen, ontoggle: (e: Event) => { detailsOpen = (e.target as HTMLDetailsElement).open; } }, h('summary', null, 'Details and more'),
          h('dl', { class: 'facts' },
            h('div', null, h('dt', null, 'Warden mark'), h('dd', { class: 'mono' }, a.playerId)),
            h('div', null, h('dt', null, 'Isle mark'), h('dd', { class: 'mono' }, empire.commander?.planetId || 'none yet')),
            h('div', { style: { gridColumn: 'span 2' } }, h('dt', null, 'Soulstone mark'), h('dd', { class: 'mono', style: { fontSize: '13px' } }, '…' + a.address.slice(-12)))),
          h('button', { type: 'button', class: 'btn ghost small', style: { marginTop: '14px', color: 'var(--ember-ink)' }, onclick: async () => {
            if (await confirmBox('Forget this soulstone?', 'It leaves this browser. Only your soul-words can bring your warden back.', 'Forget it')) { wallet.forget(); close(); }
          } }, 'Forget this soulstone')));
      return;
    }

    // Bound but unsworn: a soulstone whose words were never shown goes there first.
    if (wallet.unlocked && !a?.playerId) {
      if (mode === 'choose') mode = !wallet.backedUp && wallet.deviceSealed ? 'keep' : 'coven';
      else if (mode === 'speak') mode = 'coven';
    }

    if (mode === 'choose') {
      body.append(head('The Oath', 'Bind your soulstone'),
        road(0),
        h('p', null, 'Your soulstone is your name in the sky. It stays sealed in this browser; Wyrmhold only asks it to set its seal on the rites you choose.'),
        h('div', { class: 'stack', style: { marginTop: '14px' } },
          h('button', { type: 'button', class: 'choice', disabled: busy, onclick: async () => {
            busy = true; paint();
            try { if (wallet.state === 'empty') await wallet.createInstant(); revealed = await wallet.revealPhrase(''); mode = 'keep'; }
            catch (e) { toast((e as Error).message, 'enemy', 6000); }
            busy = false; paint();
          } },
            h('span', null, busy ? 'Forging…' : 'I’m new: forge a soulstone', h('small', null, 'Made for you in a moment, sealed to this browser'))),
          h('button', { type: 'button', class: 'choice', onclick: () => { mode = 'speak'; paint(); } },
            h('span', null, 'I’ve played before: speak my soul-words', h('small', null, 'Bring back a warden you already hold')))));
      return;
    }

    if (mode === 'speak') {
      const words = h('textarea', { id: 'words', autocomplete: 'off', placeholder: 'twelve or twenty-four words, in order', value: spoken, oninput: (e: Event) => { spoken = (e.target as HTMLTextAreaElement).value; } }) as HTMLTextAreaElement;
      // h() skips false props: switch off spellcheck (which may send text off-device) and autocorrect by hand
      words.spellcheck = false; words.setAttribute('spellcheck', 'false'); words.setAttribute('autocapitalize', 'off'); words.setAttribute('autocorrect', 'off');
      body.append(head('The Oath', 'Speak your soul-words'),
        road(0),
        h('p', null, 'Speak the words in order and your warden wakes exactly as you left them: the same isle, the same beasts, the same alpha.'),
        h('div', { class: 'field' }, h('label', { for: 'words' }, 'Soul-words'), words),
        speakErr ? h('p', { class: 'inline-err', role: 'alert' }, icon(ICON.warn, 15), h('span', null, speakErr)) : '',
        h('div', { class: 'row between', style: { marginTop: '16px' } },
          h('button', { type: 'button', class: 'btn ghost', onclick: () => { mode = 'choose'; speakErr = ''; paint(); } }, 'Back'),
          h('button', { type: 'button', class: 'btn gold', disabled: busy, onclick: async () => {
            busy = true; paint();
            try { await wallet.createInstant(words.value); spoken = ''; speakErr = ''; wallet.markBackedUp(); await wallet.resolvePlayers(); toast('Your soulstone wakes.', 'player'); mode = 'coven'; }
            catch (e) { speakErr = speak((e as Error).message); }
            busy = false; paint();
          } }, busy ? 'Listening…' : 'Bind it')));
      return;
    }

    if (mode === 'keep') {
      if (!revealed) { void reveal('keep'); body.append(head('The Oath', 'Keep your soul-words'), road(1), h('p', { class: 'italic' }, 'Reading the words…')); return; }
      body.append(head('The Oath', 'Keep your soul-words'), road(1),
        ...wordsPanel('Next: choose a coven', () => { revealed = ''; mode = 'coven'; paint(); }, () => { revealed = ''; mode = 'coven'; paint(); }));
      return;
    }

    // coven (soulstone bound, no warden yet)
    const rule = h('p', { class: 'rule', id: 'name-rule' });
    const sworn = h('button', { type: 'button', class: 'btn gold block', style: { marginTop: '18px', minHeight: '52px' }, onclick: swear }) as HTMLButtonElement;
    const check = () => {
      const why = nameProblem(name);
      rule.className = 'rule' + (why && why !== 'empty' ? ' bad' : !why ? ' ok' : '');
      rule.textContent = why === 'empty' ? '3–20 letters or digits. Spaces become _' : why || '✓ A fine name';
      sworn.disabled = busy || !coven || !!why;
      sworn.textContent = busy ? 'Swearing…' : !coven ? 'Choose a coven' : why ? 'Name your warden' : 'Swear the oath and seek my isle';
    };
    const nameIn = h('input', { id: 'warden-name', value: name, maxLength: 20, autocomplete: 'nickname', placeholder: 'e.g. Ashwen', 'aria-describedby': 'name-rule', oninput: (e: Event) => {
      const el = e.target as HTMLInputElement;
      const fixed = el.value.replace(/\s/g, '_');
      if (fixed !== el.value) { const at = el.selectionStart; el.value = fixed; el.setSelectionRange(at, at); }
      name = fixed; check();
    } }) as HTMLInputElement;
    const roll = h('button', { type: 'button', class: 'btn small', title: 'Suggest a name', onclick: () => { name = pick(FIRST) + pick(LAST); nameIn.value = name; check(); } }, 'Suggest one');
    body.append(head('The Oath', 'Name your warden'),
      road(2),
      h('div', { class: 'field' }, h('label', { for: 'warden-name' }, 'Your warden’s name'), h('div', { class: 'row', style: { flexWrap: 'nowrap', gap: '8px' } }, nameIn, roll), rule),
      h('p', { class: 'label', style: { marginTop: '18px' } }, 'Choose a coven'),
      h('p', { class: 'muted', style: { margin: '4px 0 10px', fontSize: '14px' } }, 'A coven shares its leyline so your first rites have mana. Unsure? Take the first one.'),
      covenPicker(check),
      sworn,
      // a refusal is told under the button that asked
      swearErr ? h('p', { class: 'inline-err', role: 'alert' }, icon(ICON.warn, 15), h('span', null, swearErr)) : '');
    check();
  }
  // empire.onChange calls back at once: wire listeners only after the state above exists.
  offs = [wallet.onChange(() => paint()), enlisting.onChange(() => paint()), empire.onChange(() => paint()), txq.onChange(() => { if (sworeHere) paint(); })];
  // keyboard and screen-reader users land inside the dialog, on its first real choice
  setTimeout(() => (body.querySelector('input:not([type=checkbox]), button.choice, .btn.gold') as HTMLElement | null)?.focus(), 60);
  document.addEventListener('keydown', esc);
  window.addEventListener('hashchange', close);
}
