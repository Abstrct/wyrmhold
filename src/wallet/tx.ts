/* Building, signing and broadcasting Cosmos SDK transactions (SIGN_MODE_DIRECT), straight to
 * the chain's LCD — which answers browsers (CORS-open, POST with JSON allowed). */
import { Writer, any, coin } from './proto';
import { encodeAny, type Msg } from './encode';
import { signBytes, toB64, type KeyPair } from './keys';
import { LCD_URL } from '../chain/lcd';

export const FEE_DENOM = 'ualpha';
export const DEFAULT_GAS = 500_000;
/** Simulated gas × this, so a block's state moving under us doesn't run the tx out of gas. */
export const GAS_MULTIPLIER = 1.6;

export interface SignerData { chainId: string; accountNumber: bigint; sequence: bigint }
export interface Fee { amount: { denom: string; amount: string }[]; gas: number }

export function txBody(msgs: Msg[], memo = ''): Uint8Array {
  const w = new Writer();
  for (const m of msgs) w.msg(1, encodeAny(m), true);
  w.string(2, memo);
  return w.finish();
}

export function authInfo(pubKey: Uint8Array, sequence: bigint, fee: Fee): Uint8Array {
  const pk = any('/cosmos.crypto.secp256k1.PubKey', new Writer().bytes(1, pubKey).finish());
  const modeInfo = new Writer().msg(1, new Writer().uint(1, 1), true);   // single { mode: SIGN_MODE_DIRECT }
  const signerInfo = new Writer().msg(1, pk).msg(2, modeInfo, true).uint(3, sequence);
  const feeW = new Writer();
  for (const c of fee.amount) feeW.msg(1, coin(c), true);
  feeW.uint(2, fee.gas);
  return new Writer().msg(1, signerInfo, true).msg(2, feeW, true).finish();
}

export function signDoc(body: Uint8Array, auth: Uint8Array, chainId: string, accountNumber: bigint): Uint8Array {
  // account_number 0 is a real account (the first one): proto3 drops it, which is still right.
  return new Writer().bytes(1, body).bytes(2, auth).string(3, chainId).uint(4, accountNumber).finish();
}

export function txRaw(body: Uint8Array, auth: Uint8Array, sigs: Uint8Array[]): Uint8Array {
  const w = new Writer().bytes(1, body).bytes(2, auth);
  for (const s of sigs) w.bytes(3, s);
  return w.finish();
}

export function signTx(key: KeyPair, msgs: Msg[], signer: SignerData, fee: Fee, memo = ''): Uint8Array {
  const body = txBody(msgs, memo);
  const auth = authInfo(key.pubKey, signer.sequence, fee);
  const sig = signBytes(key.privKey, signDoc(body, auth, signer.chainId, signer.accountNumber));
  return txRaw(body, auth, [sig]);
}

/* ── The chain, over LCD ──────────────────────────────────────────────── */

export class ChainTxError extends Error {
  code: number; codespace: string; log: string; hash?: string;
  constructor(code: number, codespace: string, log: string, hash?: string) {
    super(humanError(code, codespace, log));
    this.code = code; this.codespace = codespace; this.log = log; this.hash = hash;
  }
  /** "account sequence mismatch, expected 12, got 11" → 12 */
  get expectedSequence(): bigint | null {
    const m = /expected (\d+), got (\d+)/.exec(this.log);
    return this.code === 32 && m ? BigInt(m[1]) : null;
  }
}

/** Drop the SDK's source-location and gas tail ("[cosmos/cosmos-sdk@…/baseapp.go:1052] with gas used: 'N'"). */
export function stripCosmosTail(s: string): string { return s.replace(/\s*\[cosmos\/cosmos-sdk[^\]]*\].*$/s, '').replace(/\s*with gas used:.*$/s, '').trim(); }

/** Raw chain logs into something a commander can act on. */
export function humanError(code: number, codespace: string, log: string): string {
  const l = log || '';
  if (codespace === 'structs-ante' || code >= 2000) {
    const ante: Record<number, string> = {
      2010: 'This soulstone belongs to no warden yet', 2011: 'You are not permitted that rite',
      2020: 'Only one breath-spending rite at a time', 2021: 'Breath already spent this bell — next bell', 2022: 'Breath spent this bell — next bell',
      2030: 'One chant per beast per rite', 2031: 'That chant was already tried this bell — next bell', 2033: 'That beast must rest this bell',
      2040: 'Too many rites from this warden this bell', 2041: 'Too many rites from this soulstone this bell — next bell', 2050: 'Free rites must carry no offering',
    };
    if (ante[code]) return ante[code];
  }
  if (code === 32) return 'Out of turn — speaking it again in the right order';
  if (code === 5 || /insufficient funds/i.test(l)) return 'Not enough alpha for that';
  if (code === 11 || /out of gas/i.test(l)) return 'The rite ran short of strength — again, with more';
  if (code === 13) return 'The offering is too small for this keeper';
  if (code === 19) return 'Already spoken (the rite is on the wind)';
  if (/cannot handle new load requirements/i.test(l)) return 'Not enough spare mana for that (or no more may be summoned)';
  if (/work failure/i.test(l)) return 'The chant was refused (the clock moved) — chanting again';
  if (/insufficient charge|not enough charge|charge \(\d+\) is (less|lower)/i.test(l)) return 'Not enough breath yet — wait a few bells';
  // war's refusals, as a warden would say them
  const need = /required charge of (\d+)/i.exec(l);
  if (need) return `Not enough breath yet (it needs ${need[1]}) — wait a few bells`;
  if (/shields_active/i.test(l)) return 'Their Elder Wyrm still guards their isle: fell it, and the plunder lands';
  if (/not_first_in_queue/i.test(l)) return 'Another warband hangs first in their sky: your plunder waits its turn';
  if (/is out_of_range from/i.test(l)) return 'Out of reach: that realm is beyond this beast';
  if (/is unreachable from/i.test(l)) return 'Out of reach from where your warband hangs';
  if (/is hidden from/i.test(l)) return 'Veiled: only a beast of its own realm can find it';
  if (/target struct \([^)]*\) is destroyed/i.test(l)) return 'It has already fallen';
  if (/no_command_struct/i.test(l)) return 'Your warband has no Elder Wyrm to ride on';
  if (/command_offline/i.test(l)) return 'Your Elder Wyrm slumbers: wake it to ride';
  if (/permission/i.test(l)) return 'You hold no right over that';
  if (/proof|difficulty|hash/i.test(l) && /invalid|insufficient|does not/i.test(l)) return 'The chant’s work was refused — keep chanting';
  if (/player[^.]*(is )?offline|halted|load exceeds/i.test(l) && !/must be offline/i.test(l)) return 'Your beasts drink more mana than you pour';
  const clean = stripCosmosTail(l).replace(/^failed to execute message; message index: \d+: /, '');
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : `The ledger refused the rite (sign ${code})`;
}

async function lcdJson<T>(path: string, init?: RequestInit, timeoutMs = 20000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(LCD_URL + path, { ...init, signal: ctl.signal });
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { throw new Error(`The ledger-keeper answered ${res.status}: ${text.slice(0, 120)}`); }
    if (!res.ok) {
      const err = new Error(body?.message || `The ledger-keeper answered ${res.status}`) as Error & { status: number; code?: number };
      err.status = res.status; err.code = body?.code;
      throw err;
    }
    return body as T;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('The ledger took too long to answer');
    throw e;
  } finally { clearTimeout(timer); }
}

let chainIdP: Promise<string> | null = null;
export function chainId(): Promise<string> {
  if (!chainIdP) chainIdP = lcdJson<{ default_node_info: { network: string } }>('/cosmos/base/tendermint/v1beta1/node_info')
    .then((r) => r.default_node_info.network).catch((e) => { chainIdP = null; throw e; });
  return chainIdP;
}

export interface AccountInfo { exists: boolean; accountNumber: bigint; sequence: bigint }
export async function account(address: string): Promise<AccountInfo> {
  try {
    const r = await lcdJson<{ account: { account_number?: string; sequence?: string; base_account?: { account_number: string; sequence: string } } }>(`/cosmos/auth/v1beta1/accounts/${address}`);
    const a = r.account.base_account || r.account;
    return { exists: true, accountNumber: BigInt(a.account_number || '0'), sequence: BigInt(a.sequence || '0') };
  } catch (e) {
    if ((e as { status?: number }).status === 404 || /not found/i.test((e as Error).message)) return { exists: false, accountNumber: 0n, sequence: 0n };
    throw e;
  }
}

export async function balances(address: string): Promise<{ denom: string; amount: string }[]> {
  const r = await lcdJson<{ balances: { denom: string; amount: string }[] }>(`/cosmos/bank/v1beta1/balances/${address}?pagination.limit=200`);
  return r.balances || [];
}

/** Gas a tx would use, by dry-running it. Signature checks are skipped by simulation, but a
 * real signature keeps the ante handler's gas accounting identical to the real thing. */
export async function simulate(txBytes: Uint8Array): Promise<number> {
  const r = await lcdJson<{ gas_info: { gas_used: string } }>('/cosmos/tx/v1beta1/simulate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tx_bytes: toB64(txBytes) }),
  }, 30000);
  return Number(r.gas_info.gas_used);
}

export interface Broadcast { hash: string }
export async function broadcast(txBytes: Uint8Array): Promise<Broadcast> {
  const r = await lcdJson<{ tx_response: { code: number; codespace: string; raw_log: string; txhash: string } }>('/cosmos/tx/v1beta1/txs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tx_bytes: toB64(txBytes), mode: 'BROADCAST_MODE_SYNC' }),
  }, 30000);
  const t = r.tx_response;
  if (t.code) throw new ChainTxError(t.code, t.codespace, t.raw_log, t.txhash);
  return { hash: t.txhash };
}

export interface TxResult { hash: string; height: number; code: number; log: string; gasUsed: number; events: { type: string; attributes: { key: string; value: string }[] }[] }
export async function getTx(hash: string): Promise<TxResult | null> {
  try {
    const r = await lcdJson<{ tx_response: { txhash: string; height: string; code: number; raw_log: string; gas_used: string; events: TxResult['events'] } }>(`/cosmos/tx/v1beta1/txs/${hash}`);
    const t = r.tx_response;
    return { hash: t.txhash, height: Number(t.height), code: t.code, log: t.raw_log, gasUsed: Number(t.gas_used), events: t.events || [] };
  } catch (e) {
    if ((e as { status?: number }).status === 404 || /not found/i.test((e as Error).message)) return null;
    throw e;
  }
}
