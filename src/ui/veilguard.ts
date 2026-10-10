/* The veil-guard: the last line of defence for the realm's tongue. Whatever text reaches the
 * page — however it was assembled, from whichever module, at whatever moment — is checked for
 * words from outside the realm and retold before it can be read. Soul-words (and anything marked
 * data-raw) are never touched: they must stay exactly as spoken. */
import { speak } from '../lore';

const OUTSIDE = /\b(structs?|starships?|planets?|fleets?|players?|guilds?|commanders?|ore|charge|reactors?|substations?|chain|blocks?|energy|watts?|mempool|gas|fees?|wallet|grid|capacity|proofs?|hash\w*|enlist\w*|ambits?|tx|battery)\b/i;
const ATTRS = ['title', 'aria-label', 'placeholder', 'alt'];
let healed = 0;
const log: string[] = [];
const note = (from: string, to: string) => { healed++; if (log.length < 200) log.push(`${from} ⟶ ${to}`); };

function exempt(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    if (e.hasAttribute?.('data-raw')) return true;
    const t = e.tagName;
    if (t === 'SCRIPT' || t === 'STYLE' || t === 'TEXTAREA' || t === 'INPUT' || t === 'CODE') return true;
  }
  return false;
}

function healText(n: Text) {
  const v = n.nodeValue;
  if (!v || !OUTSIDE.test(v) || exempt(n.parentElement)) return;
  const out = speak(v);
  if (out !== v) { n.nodeValue = out; note(v, out); }
}

function healAttrs(el: Element) {
  if (exempt(el)) return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v && OUTSIDE.test(v)) { const out = speak(v); if (out !== v) { el.setAttribute(a, out); note(`[${a}] ${v}`, out); } }
  }
}

function healTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) { healText(root as Text); return; }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  healAttrs(root as Element);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) healText(n as Text); else healAttrs(n as Element);
  }
}

export function guardTheVeil() {
  healTree(document.body);
  const docTitle = () => { if (OUTSIDE.test(document.title)) document.title = speak(document.title); };
  docTitle();
  new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === 'characterData') healText(m.target as Text);
      else if (m.type === 'attributes') healAttrs(m.target as Element);
      else m.addedNodes.forEach(healTree);
    }
    docTitle();
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  (window as unknown as { __veil: () => number; __veilLog: () => string[] }).__veil = () => healed;
  (window as unknown as { __veilLog: () => string[] }).__veilLog = () => log.slice();
}
