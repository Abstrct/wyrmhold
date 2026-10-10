/* The relay (relay/relay.mjs, inside the Vite dev server) holds each browser's Guild API cookie,
 * keyed by a random id the page sends as `x-relay-session`. The id is stable per browser
 * (localStorage) so a reload keeps the guild session. Shared key with src/chat/relay.ts. */

const KEY = 'wyrmhold.relay.session';
let memo: string | null = null;

function randomId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function relaySession(): string {
  if (memo) return memo;
  try {
    const v = localStorage.getItem(KEY);
    if (v && /^[A-Za-z0-9_-]{16,64}$/.test(v)) return (memo = v);
    memo = randomId();
    localStorage.setItem(KEY, memo);
  } catch { memo = memo || randomId(); }
  return memo;
}

/** A new id: the relay's cookie jar for the old one (guild sessions) is no longer reachable from here. */
export function rotateRelaySession() {
  memo = randomId();
  try { localStorage.setItem(KEY, memo); } catch { /* memory only */ }
}

/** Where the relay lives, or null to talk to each guild's servers directly (they must send CORS).
 * VITE_RELAY_URL unset: the relay inside the dev server under `vite`, direct in a build.
 * "off": direct, even in dev. "/": this origin. A URL: a relay there (listed in its RELAY_ORIGINS). */
const ENV = (import.meta as { env?: Record<string, unknown> }).env || {};
const RELAY_URL = typeof ENV.VITE_RELAY_URL === 'string' ? ENV.VITE_RELAY_URL : '';
export const RELAY_BASE: string | null = RELAY_URL === 'off' ? null : RELAY_URL ? RELAY_URL.replace(/\/+$/, '') : ENV.DEV === true ? '' : null;

export function relayFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  headers.set('x-relay-session', relaySession());
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  return fetch((RELAY_BASE ?? '') + path, { ...init, headers });
}
