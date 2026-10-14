/* Where the warden is. Every screen lives in the path (/hold/, /bestiary/stone-troll), so each is a
 * real page that search engines index and link cards draw. Routes are written from the app's root
 * ('/', '/hold', '/hold/1-1000'); url() puts the site's base in front, and h() does that for every
 * href it is given. Old '#/hold' links (shared before the sky had paths) still land. */

const BASE = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + '/';
const EVENT = 'wyrm:route';

/** The route the warden is on: '/', '/hold', '/hold/1-1000'. */
export function here(): string {
  const p = decodeURI(location.pathname);
  const rel = p.startsWith(BASE) ? p.slice(BASE.length) : p.replace(/^\/+/, '');
  return '/' + rel.replace(/\/+$/, '').replace(/\/index(\.html)?$|\.html$/, '').replace(/^index$/, '');
}

/** The address of a route. A section ('/hold') ends in a slash, as its built page does. */
export function url(route: string): string {
  const parts = route.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  if (!parts.length) return BASE;
  return BASE + parts.map(encodeURIComponent).join('/') + (parts.length === 1 ? '/' : '');
}

const tell = () => window.dispatchEvent(new Event(EVENT));

/** Go to a route; going where the warden already is does nothing (as a hash did), unless `again`. */
export function go(route: string, opts: { replace?: boolean; again?: boolean } = {}) {
  const same = route.replace(/\/+$/, '') === here() || (route === '/' && here() === '/');
  if (same && !opts.again) return;
  if (!same) history[opts.replace ? 'replaceState' : 'pushState'](null, '', url(route));
  tell();
}

/** Show the route in the address bar without moving (a screen choosing within itself). */
export function mark(route: string) { history.replaceState(history.state, '', url(route)); }

/** Hear every move: links, Back and Forward, go(). Returns a disposer. */
export function onRoute(fn: () => void) {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

/** An old '#/hold/…' address becomes its path, in place. True if it did. */
function fromHash(): boolean {
  if (!/^#\//.test(location.hash)) return false;
  history.replaceState(history.state, '', url(location.hash.slice(1)) + location.search);
  return true;
}

let started = false;
/** Start listening: Back/Forward, old hash links, and clicks on the game's own links. */
export function startNav() {
  if (started) return;
  started = true;
  fromHash();
  window.addEventListener('popstate', tell);
  window.addEventListener('hashchange', () => { if (fromHash()) tell(); });
  // a plain click on a link to one of the game's own pages moves without reloading the sky
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
    const to = new URL(a.href, location.href);
    if (to.origin !== location.origin || !to.pathname.startsWith(BASE) || /\.\w+$/.test(to.pathname)) return;
    if (to.pathname === location.pathname && to.hash && !to.hash.startsWith('#/')) return;   // an anchor within the page
    e.preventDefault();
    go('/' + decodeURI(to.pathname.slice(BASE.length)));
  });
}
