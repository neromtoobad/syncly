// The CFO's decision log: append-only, hash-chained, and signed by the CFO's key. Each entry says
// what the CFO saw, which rule fired, what it did (or would do, or escalated), and the transaction.
// Anyone can replay it and check that nothing was edited afterwards (verifyLog).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { keccak256, toBytes, recoverMessageAddress, type Hex } from 'viem';
import { DATA_DIR, DRY } from '../config.ts';
import { account, hasSeed } from '../wallets.ts';
import { publish } from '../bus.ts';

export type DecisionKind =
  | 'epoch' | 'allowance' | 'top-up' | 'move' | 'propose' | 'escalate' | 'hold'
  | 'payee-pinned' | 'payee-refused' | 'screen-refused'
  | 'autopay' | 'pay-propose' | 'screen' | 'report'
  | 'reclaim' // surplus an agent doesn't need, taken back to the vault
  | 'naira'; // the naira float paid a customer's escrow (naira.ts) // Syncly Pay: bills paid inside a business's own on-chain rules, screening, weekly reports
export type Decision = {
  n: number;
  at: string;
  kind: DecisionKind;
  summary: string; // one plain sentence
  rule: string; // the policy rule that fired
  inputs: Record<string, unknown>; // what the CFO saw when it decided
  key?: string; // groups repeats of the same concern (used to avoid re-escalating every tick)
  amount?: number;
  agent?: string;
  tx?: string;
  proposal?: number;
  status: 'done' | 'would-do' | 'escalated' | 'refused' | 'failed';
  demo: boolean;
  prev: string;
  hash: Hex;
  sig?: Hex;
};
type Draft = Omit<Decision, 'n' | 'at' | 'demo' | 'prev' | 'hash' | 'sig'>;

const file = () => join(DATA_DIR, 'cfo', 'decisions.jsonl');
function all(): Decision[] {
  if (!existsSync(file())) return [];
  return readFileSync(file(), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
/** Newest first; demo and live entries never mix. */
export function decisions(limit = 200): Decision[] {
  return all().filter((d) => d.demo === DRY).slice(-limit).reverse();
}
export function lastWith(key: string): Decision | undefined {
  return decisions(500).find((d) => d.key === key);
}
/** True when the same concern was already logged within `ms` (so a repeat isn't logged every tick). */
export const loggedWithin = (key: string, ms: number) => { const d = lastWith(key); return !!d && Date.now() - Date.parse(d.at) < ms; };

const hashOf = (body: Omit<Decision, 'hash' | 'sig'>) => keccak256(toBytes(JSON.stringify(body)));

let queue: Promise<unknown> = Promise.resolve();
export function record(d: Draft): Promise<Decision> {
  const p = queue.then(async () => {
    const entries = all();
    const tip = entries.at(-1);
    const body = { n: (tip?.n ?? 0) + 1, at: new Date().toISOString(), ...d, demo: DRY, prev: tip?.hash ?? '0x0' };
    const hash = hashOf(body);
    const sig = hasSeed() ? await account('cfo').signMessage({ message: { raw: hash } }) : undefined;
    const entry: Decision = { ...body, hash, sig };
    mkdirSync(join(DATA_DIR, 'cfo'), { recursive: true });
    appendFileSync(file(), JSON.stringify(entry) + '\n');
    publish({ type: 'cfo', data: entry as unknown as Record<string, unknown> });
    return entry;
  });
  queue = p.catch(() => {});
  return p;
}

/** Recompute every hash, check each links to the one before, and that the CFO's key signed it. */
export async function verifyLog() {
  const entries = all();
  const cfo = hasSeed() ? account('cfo').address.toLowerCase() : null;
  for (let i = 0; i < entries.length; i++) {
    const { hash, sig, ...body } = entries[i];
    if (hashOf(body) !== hash) return { ok: false, entries: entries.length, brokenAt: body.n, why: 'hash does not match the entry' };
    if (i > 0 && body.prev !== entries[i - 1].hash) return { ok: false, entries: entries.length, brokenAt: body.n, why: 'chain broken' };
    if (sig && cfo && (await recoverMessageAddress({ message: { raw: hash }, signature: sig })).toLowerCase() !== cfo) {
      return { ok: false, entries: entries.length, brokenAt: body.n, why: 'not signed by the CFO' };
    }
  }
  return { ok: true, entries: entries.length, signer: cfo };
}
