// buy(): the only way an Syncly agent spends money. It pays an x402 endpoint from the agent's
// Circle Gateway balance on Arc, enforces a per-call price cap and a host allowlist BEFORE
// signing, and appends a receipt line to the job. No receipt, no spend.
// A few sellers only take a direct USDC transfer from the agent's own wallet (EIP-3009), and async
// ones (video) need the same payment shown again while polling; those go through payManual().
import { CHAIN_CONFIGS, GatewayClient, registerBatchScheme } from '@circle-fin/x402-batching/client';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, http as rpc, parseAbi, type Address } from 'viem';
import { ARC, DRY } from './config.ts';
import { privateKey, type Role } from './wallets.ts';
import type { Job } from './job.ts';
import { checkPayee } from './payees.ts';

export type ReceiptLine = {
  at: string;
  agent: Role;
  vendor: string;
  url: string;
  amount: string; // USDC atomic units (6 decimals), as a string
  usd: number;
  transaction: string; // Gateway settlement reference from pay()
  reason: string;
  status: number;
  dry: boolean;
  settledTx?: string; // the Arc transaction that settled this payment (filled in by settle.ts)
  settledAt?: string;
};

export class SpendRefused extends Error {}

// When a retry is safe. Before a payment is signed (the free first request that returns the 402), any
// network hiccup can be retried: nothing was paid. After signing, only a seller that says it did not
// take the payment ("verification temporarily unavailable") is retried; checked on mainnet that such a
// payment never settles. A timeout or dropped connection after signing is ambiguous: the seller may
// already have taken it. Retrying then is how an agent pays twice, so we stop and say so instead.
const TRANSIENT = /temporarily unavailable|please retry|payment verification failed|try again|timed? ?out|ETIMEDOUT|ECONNRESET|EAI_AGAIN|fetch failed|socket hang up|\b(429|502|503|504)\b|rate limit/i;
const SELLER_DECLINED = /verification temporarily unavailable|payment verification failed|please retry/i; // the seller refused the signature, so nothing was taken
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// One client per agent, with ONE price-cap hook that reads the cap for the call in flight.
// Calls for the same agent are serialized so the cap always belongs to the right call.
type Slot = { client: GatewayClient; capAtomic: bigint; refused?: string; signed: boolean; call?: { url: string; agent: string; vendor: string }; tail: Promise<unknown> };
const slots = new Map<Role, Slot>();

function slot(role: Role): Slot {
  let s = slots.get(role);
  if (s) return s;
  const client = new GatewayClient({ chain: 'arc', privateKey: privateKey(role), rpcUrl: ARC.rpc });
  const created: Slot = { client, capAtomic: 0n, signed: false, tail: Promise.resolve() };
  // Runs just before a payment is signed: price cap, then payee change control and screening.
  client.onBeforePaymentCreation(async (ctx: any) => {
    const amt = BigInt(ctx.selectedRequirements.amount);
    if (amt > created.capAtomic) {
      created.refused = `price ${Number(amt) / 1e6} USDC > cap ${Number(created.capAtomic) / 1e6}`;
      return { abort: true, reason: created.refused };
    }
    const call = created.call!;
    const refusal = await checkPayee(call.url, String(ctx.selectedRequirements.payTo), call);
    if (refusal) {
      created.refused = refusal;
      return { abort: true, reason: refusal };
    }
    created.signed = true;
  });
  slots.set(role, created);
  return created;
}

export function gateway(role: Role): GatewayClient {
  return slot(role).client;
}

export async function buy<T>(
  job: Job,
  opts: {
    agent: Role;
    vendor: string;
    url: string;
    method?: 'GET' | 'POST';
    body?: unknown;
    reason: string;
    maxUsd: number; // hard cap for this single call
    expectUsd: number; // listed price, used for budgeting and dry runs
    dryData: () => T;
    direct?: boolean; // the seller only takes a USDC transfer from the agent's own wallet
    poll?: (first: any) => string | undefined; // async seller: where to poll for the finished result
  },
): Promise<T> {
  const host = new URL(opts.url).host;
  if (!job.policy.allowHosts.includes(host)) throw new SpendRefused(`${opts.agent}: ${host} is not on the allowlist for ${job.service}`);
  if (job.spentUsd() + opts.expectUsd > job.policy.budgetUsd) {
    throw new SpendRefused(`${opts.agent}: job budget ${job.policy.budgetUsd} USDC would be exceeded`);
  }

  if (DRY) {
    // test hook: OUTLAY_DRY_FAIL="Serper Maps" makes that vendor fail like a seller whose payment check is down
    if (process.env.OUTLAY_DRY_FAIL && opts.vendor.includes(process.env.OUTLAY_DRY_FAIL)) throw new Error('Payment failed: Payment verification temporarily unavailable, please retry');
    // Demo pacing so the live job page shows the team working (OUTLAY_DRY_DELAY ms per purchase).
    const delay = Number(process.env.OUTLAY_DRY_DELAY ?? 0);
    if (delay) await new Promise((r) => setTimeout(r, delay * (0.6 + Math.random() * 0.8)));
    const data = opts.dryData();
    job.addReceipt({
      at: new Date().toISOString(), agent: opts.agent, vendor: opts.vendor, url: opts.url,
      amount: String(Math.round(opts.expectUsd * 1e6)), usd: opts.expectUsd, transaction: 'dry-run',
      reason: opts.reason, status: 200, dry: true,
    });
    return data;
  }

  if (opts.direct || opts.poll) return payManual(job, opts);

  const s = slot(opts.agent);
  const run = async () => {
    s.capAtomic = BigInt(Math.round(opts.maxUsd * 1e6));
    s.refused = undefined;
    s.call = { url: opts.url, agent: opts.agent, vendor: opts.vendor };
    try {
      let res: Awaited<ReturnType<typeof s.client.pay<T>>> | undefined;
      for (let attempt = 1; ; attempt++) {
        s.signed = false;
        try { res = await s.client.pay<T>(opts.url, { method: opts.method ?? 'POST', body: opts.body }); break; }
        catch (e: any) {
          const msg = String(e?.message ?? e);
          if (s.signed && !SELLER_DECLINED.test(msg)) {
            throw new Error(`${opts.vendor}: the call failed after the payment was signed (${msg.slice(0, 80)}). Not retried, so it can't be paid twice.`);
          }
          if (s.refused || attempt >= 3 || !TRANSIENT.test(msg)) throw e;
          job.log(opts.agent, 'retry', `${opts.vendor}: ${msg.slice(0, 60)}; ${s.signed ? 'the seller did not take the payment' : 'nothing was paid yet'}, trying again`);
          await sleep(attempt * 2500);
        }
      }
      job.addReceipt({
        at: new Date().toISOString(), agent: opts.agent, vendor: opts.vendor, url: opts.url,
        amount: res.amount.toString(), usd: Number(res.amount) / 1e6, transaction: res.transaction,
        reason: opts.reason, status: res.status, dry: false,
      });
      return res.data;
    } catch (e) {
      if (s.refused) throw new SpendRefused(`${opts.agent} refused ${opts.vendor}: ${s.refused}`);
      throw e;
    }
  };
  const p = s.tail.then(run, run);
  s.tail = p.catch(() => undefined);
  return p;
}

// ---------------------------------------------------------------- the manual path

/** The agent's own wallet can't cover a direct payment. Callers may fall back to a Gateway seller. */
export class NoWalletFunds extends SpendRefused {}

const ARC_NET = `eip155:${ARC.chainId}`;
const arcRead = createPublicClient({ chain: CHAIN_CONFIGS.arc.chain, transport: rpc(ARC.rpc) });
const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)']);
export const walletUsdc = async (role: Role) =>
  Number(await arcRead.readContract({ address: ARC.usdc as Address, abi: ERC20, functionName: 'balanceOf', args: [privateKeyToAccount(privateKey(role)).address] })) / 1e6;

type ManualSlot = { http: x402HTTPClient; address: Address; capAtomic: bigint; refused?: string; broke?: boolean; signed: boolean; call?: { url: string; agent: string; vendor: string }; tail: Promise<unknown> };
const manuals = new Map<Role, ManualSlot>();

function manualSlot(role: Role): ManualSlot {
  let m = manuals.get(role);
  if (m) return m;
  const account = privateKeyToAccount(privateKey(role));
  const client = new x402Client();
  // Gateway-batched requirements sign against the Gateway wallet; plain "exact" ones move USDC directly.
  registerBatchScheme(client, { signer: account, fallbackScheme: new ExactEvmScheme(account), networks: [ARC_NET] });
  client.registerPolicy((_v, reqs) => reqs.filter((r) => r.network === ARC_NET));
  client.setSpendControls(false); // the cap below is ours, per call
  const created: ManualSlot = { http: new x402HTTPClient(client), address: account.address, capAtomic: 0n, signed: false, tail: Promise.resolve() };
  client.onBeforePaymentCreation(async (ctx) => {
    const req = ctx.selectedRequirements;
    const amt = BigInt(req.amount);
    if (amt > created.capAtomic) return { abort: true, reason: (created.refused = `price ${Number(amt) / 1e6} USDC > cap ${Number(created.capAtomic) / 1e6}`) };
    const refusal = await checkPayee(created.call!.url, String(req.payTo), created.call!);
    if (refusal) return { abort: true, reason: (created.refused = refusal) };
    if ((req.extra as any)?.name !== 'GatewayWalletBatched') {
      const have = BigInt(await arcRead.readContract({ address: req.asset as Address, abi: ERC20, functionName: 'balanceOf', args: [account.address] }));
      if (have < amt) { created.broke = true; return { abort: true, reason: (created.refused = `wallet holds ${Number(have) / 1e6} USDC, the call costs ${Number(amt) / 1e6}`) }; }
    }
    created.signed = true;
  });
  manuals.set(role, created);
  return created;
}

async function payManual<T>(job: Job, opts: Parameters<typeof buy<T>>[1]): Promise<T> {
  const m = manualSlot(opts.agent);
  const run = async (): Promise<T> => {
    m.capAtomic = BigInt(Math.round(opts.maxUsd * 1e6));
    m.refused = undefined;
    m.broke = false;
    m.signed = false;
    m.call = { url: opts.url, agent: opts.agent, vendor: opts.vendor };
    const init: RequestInit = { method: opts.method ?? 'POST', headers: { 'content-type': 'application/json' }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) };
    try {
      // 1. The free request: the seller answers 402 with its terms. Safe to retry.
      let first: Response | undefined;
      for (let attempt = 1; ; attempt++) {
        try { first = await fetch(opts.url, init); if (first.status !== 429 && first.status < 500) break; }
        catch (e: any) { if (attempt >= 3) throw e; }
        if (attempt >= 3) break;
        await sleep(attempt * 2500);
      }
      if (first!.status !== 402) throw new Error(`${opts.vendor}: expected payment terms (402), got ${first!.status}`);
      const terms = m.http.getPaymentRequiredResponse((h) => first!.headers.get(h), await first!.json().catch(() => undefined));
      // 2. Sign (the hook above checks cap, payee and wallet funds first), then send once.
      const payment = await m.http.createPaymentPayload(terms);
      const headers = { ...(init.headers as Record<string, string>), ...m.http.encodePaymentSignatureHeader(payment) };
      let res = await fetch(opts.url, { ...init, headers });
      let data: any = await res.json().catch(() => undefined);
      if (!res.ok) throw new Error(`${opts.vendor}: ${res.status} ${String(data?.error ?? data?.message ?? '').slice(0, 120)}`);
      // 3. Async sellers: show the same payment while polling; they settle only on the finished result.
      const pollUrl = opts.poll?.(data);
      if (pollUrl) {
        const url = new URL(pollUrl, opts.url).toString();
        // the signed payment goes back only to the seller we paid, never to a host its reply names
        if (new URL(url).host !== new URL(opts.url).host) throw new Error(`${opts.vendor}: asked us to check a different host (not charged)`);
        const until = Date.now() + 10 * 60_000;
        job.log(opts.agent, 'wait', `${opts.vendor}: rendering; checking back every 6 s`);
        for (;;) {
          await sleep(6000);
          res = await fetch(url, { headers });
          data = await res.json().catch(() => undefined);
          const st = String(data?.status ?? data?.state ?? '').toLowerCase();
          if (/complet|succe|done|ready/.test(st)) break;
          if (/fail|error|cancel/.test(st) || (!res.ok && res.status !== 202)) throw new Error(`${opts.vendor}: ${st || res.status} ${String(data?.error ?? '').slice(0, 100)} (not charged)`);
          if (Date.now() > until) throw new Error(`${opts.vendor}: still not finished after 10 minutes (not charged unless it completes)`);
        }
      }
      let settled: { transaction?: string } = {};
      try { settled = m.http.getPaymentSettleResponse((h) => res.headers.get(h)); } catch { /* some sellers don't echo it */ }
      const direct = (payment.accepted.extra as any)?.name !== 'GatewayWalletBatched';
      const tx = String(settled.transaction ?? '');
      job.addReceipt({
        at: new Date().toISOString(), agent: opts.agent, vendor: opts.vendor, url: opts.url,
        amount: String(payment.accepted.amount), usd: Number(payment.accepted.amount) / 1e6, transaction: tx || 'direct',
        reason: opts.reason, status: res.status, dry: false,
        ...(direct && /^0x[0-9a-f]{64}$/i.test(tx) ? { settledTx: tx, settledAt: new Date().toISOString() } : {}),
      });
      return data as T;
    } catch (e: any) {
      if (m.broke) throw new NoWalletFunds(`${opts.agent} can't pay ${opts.vendor} directly: ${m.refused}`);
      if (m.refused) throw new SpendRefused(`${opts.agent} refused ${opts.vendor}: ${m.refused}`);
      if (m.signed) throw new Error(`${String(e?.message ?? e).slice(0, 160)}. Not retried after signing, so it can't be paid twice.`);
      throw e;
    }
  };
  const p = m.tail.then(run, run);
  m.tail = p.catch(() => undefined);
  return p;
}
