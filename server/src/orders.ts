// Orders: a customer's request from quote to decision. One order can have several runs (a revision
// re-runs the service with the customer's note). Stored as data/orders/<id>.json.
//
//   quoted → (free | paid) → queued → running → delivered → accepted | revision → … | rejected
//                                            ↘ failed (refund + bond)
// Payment modes: 'promo' (first job free, no escrow), 'simulated' (demo mode only, clearly labelled),
// 'escrow' (JobEscrow on Arc). An escrow order follows the chain: syncEscrow() reads the job's on-chain
// state and mirrors it here. Only the customer's wallet can accept, revise or reject.
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { isAddress, type Address, type Hex } from 'viem';
import { DATA_DIR, DRY } from './config.ts';
import { publish } from './bus.ts';
import { quote, type Quote } from './cfo/quote.ts';
import type { BusinessDetails } from './details.ts';
import { CATALOG, SERVICES, findService } from './services/index.ts';
import * as chain from './escrow.ts';
import { emailDelivery, emailRelease } from './mail.ts';
import { jobDir, makePreviews } from './release.ts';
import { isPrivate } from './private.ts';
import { blacklisted } from './payees.ts';

export type OrderStatus = 'quoted' | 'queued' | 'running' | 'delivered' | 'revision' | 'accepted' | 'rejected' | 'failed' | 'declined' | 'expired';
export type Order = {
  id: string;
  service: string;
  brief: string;
  privateKey?: string; // private services (a Money Report): the job page needs this key, sent in the customer's email
  customerKey?: string; // the customer's secret for deciding (accept, revise, reject, retry): in their job link and emails
  details?: BusinessDetails; // from the order form, when the service has one
  email: string;
  createdAt: string;
  quote: Quote;
  status: OrderStatus;
  payment?: { mode: 'promo' | 'simulated' | 'escrow'; at: string; tx?: string };
  runs: string[];
  revisionNote?: string;
  deliveredAt?: string;
  decision?: { kind: 'accepted' | 'rejected'; at: string; by: 'customer' | 'auto'; note?: string };
  refund?: { priceUsd: number; bondUsd: number; at: string; tx?: string };
  escrow?: {
    id: Hex; // keccak256(order id)
    customer: Address; // the only wallet that can accept, revise or reject
    spec: string; // the terms shown before payment; keccak256(spec) is on-chain as specHash
    specHash: Hex;
    fundBy: string;
    deliverBy: string;
    acceptBy?: string;
    state: chain.EscrowState;
    openTx: Hex;
    openBlock: string;
    fundTx?: Hex;
    submitTx?: Hex; // cleared when the customer asks for a revision
    deliverableHash?: Hex;
    closeTx?: Hex; // accept, reject, auto-release, late refund or cancel
  };
  pendingNote?: string; // a revision note sent before the customer's on-chain revision request
  naira?: {
    // paid in naira through Bachs; NairaDesk (the float) funded the escrow and is its customer (naira.ts)
    checkoutId: string; checkoutUrl: string; ngn: number; rate: number; createdAt: string;
    status: 'open' | 'paid' | 'underpaid' | 'expired' | 'late' | 'refunding' | 'refunded' | 'refund-failed';
    chargeId?: string; paidAt?: string; paidNgn?: number; fundTx?: Hex; method?: string;
    refund?: { ngn: number; at: string; id?: string; status: string; bondNgn?: number };
  };
  demo: boolean;
};

const dir = () => join(DATA_DIR, 'orders');
const file = (id: string) => join(dir(), `${id}.json`);

/** The brief as anyone may see it: a private order shows only what kind of job it is. */
export function publicBrief(o: Pick<Order, 'brief' | 'service' | 'privateKey'>, max = 6000): string {
  const b = o.privateKey ? `A private ${findService(o.service)?.name ?? 'job'}: the details are only on the customer's own link` : o.brief;
  return b.length > max ? b.slice(0, max - 2) + '…' : b;
}

export function saveOrder(o: Order) {
  mkdirSync(dir(), { recursive: true });
  const was = existsSync(file(o.id)) ? (JSON.parse(readFileSync(file(o.id), 'utf8')) as Order).status : undefined;
  writeFileSync(file(o.id), JSON.stringify(o, null, 2));
  // The moment a paid job is accepted its files are the customer's: the Messenger sends them.
  if (was !== 'accepted' && o.status === 'accepted' && o.payment?.mode === 'escrow') { const d = jobDir(o); if (d) void emailRelease(o, d); }
  if (was !== 'delivered' && o.status === 'delivered') makePreviews(o);
  publish({ type: 'order', orderId: o.id, data: orderEventData(o) });
}

/** What the office needs to animate an order change: who is on the team and what money moves. */
export function orderEventData(o: Order, status: string = o.status) {
  const team = findService(o.service)?.team ?? [];
  return {
    status, service: o.service, team: [...team], promo: o.quote.promo, price: o.quote.priceUsd, bond: o.quote.bondUsd,
    refund: o.refund ?? null, by: o.decision?.by ?? null,
    brief: publicBrief(o, 90), // the office whiteboard; job pages already show it
  };
}

/** Recent orders rebuilt as the exact event sequence they produced, for the office's replay mode. */
export function replay(limit = 6, only?: string) {
  const out: { id: string; service: string; events: { at: string; type: string; orderId: string; data: any }[] }[] = [];
  for (const o of listOrders().filter((x) => x.demo === DRY && x.runs.length && (!only || x.id === only)).slice(0, limit)) {
    const ev: { at: string; type: string; orderId: string; data: any }[] = [];
    if (o.payment) ev.push({ at: o.payment.at, type: 'order', orderId: o.id, data: orderEventData(o, 'queued') });
    for (const r of o.runs) {
      const j = readJob(r);
      // a private order (a Money Report) replays its moves but none of its notes, which carry the customer's figures
      for (const s of j?.steps ?? []) ev.push({ at: s.at, type: 'step', orderId: o.id, data: o.privateKey ? { ...s, note: '' } : s });
      for (const p of j?.receipt ?? []) ev.push({ at: p.at, type: 'purchase', orderId: o.id, data: p });
    }
    if (o.deliveredAt) ev.push({ at: o.deliveredAt, type: 'order', orderId: o.id, data: orderEventData(o, 'delivered') });
    if (o.decision) ev.push({ at: o.decision.at, type: 'order', orderId: o.id, data: orderEventData(o, o.decision.kind) });
    ev.sort((a, b) => a.at.localeCompare(b.at));
    out.push({ id: o.id, service: o.service, events: ev });
  }
  return out;
}
export function getOrder(id: string): Order | undefined {
  if (!/^ord_[a-z0-9_]+$/.test(id) || !existsSync(file(id))) return undefined;
  return JSON.parse(readFileSync(file(id), 'utf8'));
}
export function listOrders(): Order[] {
  if (!existsSync(dir())) return [];
  return readdirSync(dir()).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir(), f), 'utf8')) as Order)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function readJob(jobId: string): any | undefined {
  const f = join(DATA_DIR, 'jobs', jobId, 'job.json');
  if (!existsSync(f)) return undefined;
  const job = JSON.parse(readFileSync(f, 'utf8'));
  const d = join(DATA_DIR, 'jobs', jobId, 'deliverable.md');
  job.deliverable = existsSync(d) ? readFileSync(d, 'utf8') : '';
  return job;
}

// ---------------------------------------------------------------- history for the CFO

function historyFor(service: string) {
  const orders = listOrders().filter((o) => o.service === service && o.demo === DRY);
  const costs: number[] = [];
  for (const o of orders) for (const r of o.runs) { const j = readJob(r); if (j?.status === 'delivered') costs.push(j.spentUsd); }
  return {
    costs,
    accepted: orders.filter((o) => o.decision?.kind === 'accepted').length,
    rejected: orders.filter((o) => o.decision?.kind === 'rejected').length,
  };
}

/** Free BOND cover: read from the vault when escrow is on; otherwise the policy number stands in (3 USDC). */
function bondPoolFree(): number {
  if (chain.DEP) return chain.bondFreeUsd() ?? 0;
  const open = listOrders().filter((o) => o.demo === DRY && o.payment?.mode !== 'promo' && ['queued', 'running', 'delivered', 'revision'].includes(o.status));
  return Math.max(0, 3 - open.reduce((s, o) => s + o.quote.bondUsd, 0));
}
/** Free jobs get 2 USDC of tools a week (a rolling 7 days, the CFO's planning period). */
function promoLeft(): number {
  const since = Date.now() - 7 * 86400_000;
  const used = listOrders().filter((o) => o.demo === DRY && o.payment?.mode === 'promo' && o.status !== 'failed' && Date.parse(o.payment.at) > since).reduce((s, o) => s + o.quote.estCostUsd, 0);
  return Math.max(0, 2 - used);
}

export function createQuote(input: { service: string; brief: string; email: string; details?: BusinessDetails }): Order {
  const item = CATALOG.find((c) => c.id === input.service);
  if (!item || !item.live) throw new Error('unknown or not-yet-live service');
  const email = input.email.trim().toLowerCase();
  // One free job per email, on the services marked freeFirst (the Website). Demo orders, and free jobs we
  // failed to deliver, never use it up.
  const firstJob = 'freeFirst' in item && item.freeFirst && !listOrders().some((o) => o.demo === DRY && o.email === email && o.payment?.mode === 'promo' && o.status !== 'failed');
  const q = quote({
    service: item.id, priceUsd: item.priceUsd, listedCostUsd: item.listedCostUsd, history: historyFor(item.id),
    bondPoolFreeUsd: bondPoolFree(), firstJobForCustomer: firstJob, promoLeftUsd: promoLeft(), deliverHours: 1,
  });
  const o: Order = {
    id: `ord_${Date.now().toString(36)}_${randomBytes(2).toString('hex')}`,
    service: item.id, brief: input.brief.trim().slice(0, 6000), ...(input.details ? { details: input.details } : {}), email, createdAt: new Date().toISOString(),
    quote: q, status: q.decision === 'decline' ? 'declined' : 'quoted', runs: [], demo: DRY,
  };
  // One key per order, given only to whoever placed it (the quote response) and in their emails. A private order
  // opens with the same key, so one link does both.
  o.customerKey = randomBytes(12).toString('base64url');
  if (isPrivate(item.id)) o.privateKey = o.customerKey;
  saveOrder(o);
  return o;
}

/** On the house: the owner gives a customer a free redo of one of their orders. Same service, brief, details,
 *  uploads and email; run free, so the result is the customer's straight away. */
export function redoOnTheHouse(from: Order): Order {
  const o = createQuote({ service: from.service, brief: from.brief, email: from.email, details: from.details as BusinessDetails | undefined });
  if (o.status !== 'quoted') throw new Error("The CFO can't take it right now: the team isn't funded for this service.");
  o.quote = { ...o.quote, promo: true, reasons: [...o.quote.reasons, `On the house: a free redo of ${from.id}, given by the owner`] };
  saveOrder(o);
  void start(o, 'promo');
  return o;
}

// ---------------------------------------------------------------- lifecycle

export async function start(o: Order, mode: 'promo' | 'simulated' | 'escrow', tx?: string) {
  if (o.status !== 'quoted') throw new Error(`order is ${o.status}`);
  if (mode === 'promo' && !o.quote.promo) throw new Error('this quote is not free');
  if (mode === 'simulated' && !DRY) throw new Error('simulated payment only exists in demo mode');
  o.payment = { mode, at: new Date().toISOString(), tx };
  o.status = 'queued';
  saveOrder(o);
  void run(o);
}

async function run(o: Order) {
  const svc = SERVICES[o.service];
  o.status = 'running';
  saveOrder(o);
  const brief = o.revisionNote ? `${o.brief}\n\nRevision requested by the customer: ${o.revisionNote}` : o.brief;
  let job: Awaited<ReturnType<typeof svc.run>>;
  try {
    job = await svc.run(brief, { orderId: o.id, details: o.details });
  } catch (e: any) {
    // a crash inside a service must not leave the order "running" forever: it fails, and a free job can be retried
    console.error(`order ${o.id}: ${e?.message ?? e}`);
    const fresh = getOrder(o.id)!;
    fresh.status = 'failed';
    if (fresh.payment?.mode !== 'promo' && !fresh.escrow) fresh.refund = { priceUsd: fresh.quote.priceUsd, bondUsd: fresh.quote.bondUsd, at: new Date().toISOString() };
    saveOrder(fresh);
    return;
  }
  await emailDelivery(job, o).catch(() => {}); // the Messenger emails the delivery (never fails the job)
  const fresh = getOrder(o.id)!;
  fresh.runs.push(job.id);
  if (job.status === 'delivered') {
    fresh.status = 'delivered';
    fresh.deliveredAt = new Date().toISOString();
  } else {
    // We failed to deliver: the guarantee applies (refund + bond) for paid orders.
    fresh.status = 'failed';
    // escrow refunds happen on-chain once the deadline passes (syncEscrow records them)
    if (fresh.payment?.mode !== 'promo' && !fresh.escrow) fresh.refund = { priceUsd: fresh.quote.priceUsd, bondUsd: fresh.quote.bondUsd, at: new Date().toISOString() };
  }
  saveOrder(fresh);
  if (fresh.escrow) void syncEscrow(fresh.id).catch((e) => console.error(`escrow ${fresh.id}: ${e.message}`));
}

export function decide(o: Order, kind: 'accept' | 'reject' | 'revise', note?: string, by: 'customer' | 'auto' = 'customer') {
  if (o.status !== 'delivered') throw new Error(`order is ${o.status}`);
  if (o.escrow) throw new Error('This job is paid through escrow on Arc: accept, revise or reject from the wallet that paid.');
  const at = new Date().toISOString();
  if (kind === 'accept') {
    o.status = 'accepted';
    o.decision = { kind: 'accepted', at, by };
  } else if (kind === 'reject') {
    o.status = 'rejected';
    o.decision = { kind: 'rejected', at, by, note };
    if (o.payment?.mode !== 'promo') o.refund = { priceUsd: o.quote.priceUsd, bondUsd: o.quote.bondUsd, at };
  } else {
    if (o.revisionNote !== undefined) throw new Error('one revision per order');
    revise(o, note);
    return;
  }
  saveOrder(o);
}

function revise(o: Order, note?: string) {
  o.revisionNote = (note ?? '').slice(0, 800) || 'Please improve it.';
  o.status = 'revision';
  saveOrder(o);
  o.status = 'queued';
  void run(o);
}

/**
 * A deploy or a crash stops the process mid-job, and the job lived only in memory. At boot, orders that were
 * paid (or free) and still queued, running or in revision are started again, unless an escrow's delivery
 * deadline has passed (the contract refunds those).
 */
export function resumeInterrupted() {
  for (const o of listOrders()) {
    if (o.demo !== DRY || !o.payment || !['queued', 'running', 'revision'].includes(o.status)) continue;
    if (o.escrow && Date.now() > Date.parse(o.escrow.deliverBy)) continue;
    console.log(`resuming ${o.id} (${o.service}): the server restarted while it was ${o.status}`);
    o.status = 'queued';
    saveOrder(o);
    void run(o);
  }
}

/** A paid job still funded in escrow can be tried again until 20 minutes before its delivery deadline. */
export const canRetryPaid = (o: Order) =>
  o.status === 'failed' && !o.refund && o.escrow?.state === 'Funded' && Date.now() < Date.parse(o.escrow.deliverBy) - 20 * 60_000;

/** A failed job can run again: a free one, or a paid one whose escrow is still funded well before the deadline. */
export function retry(o: Order) {
  if (o.status !== 'failed') throw new Error(`order is ${o.status}`);
  if (o.payment?.mode !== 'promo' && !canRetryPaid(o)) {
    throw new Error(o.escrow && !o.refund ? 'Too close to the deadline to try again. The contract refunds you, plus the bond, at the deadline.' : 'This order was refunded with the bond; place a new order.');
  }
  o.status = 'queued';
  saveOrder(o);
  void run(o);
}

/** Silence means yes: delivered orders auto-accept after 48h (the escrow does the same on-chain). */
export function autoAcceptDue(windowMs = 48 * 3600_000) {
  for (const o of listOrders()) if (!o.escrow && o.status === 'delivered' && o.deliveredAt && Date.now() - Date.parse(o.deliveredAt) > windowMs) decide(o, 'accept', undefined, 'auto');
}

// ---------------------------------------------------------------- escrow on Arc

/** The terms the customer pays against. Their hash is sealed on-chain when the escrow opens. */
function specFor(o: Order, customer: Address) {
  const item = findService(o.service)!;
  return JSON.stringify({
    order: o.id, service: item.name, brief: publicBrief(o), customer, priceUsdc: o.quote.priceUsd, bondUsdc: o.quote.bondUsd,
    deliverHours: o.quote.deliverHours, acceptWindowHours: 48, oneFreeRevision: true, youGet: item.youGet,
  });
}

const busy = new Set<string>();
async function locked<T>(id: string, f: () => Promise<T>): Promise<T> {
  while (busy.has(id)) await new Promise((r) => setTimeout(r, 200));
  busy.add(id);
  try { return await f(); } finally { busy.delete(id); }
}

/** The CFO opens this quote's escrow on Arc for the customer's wallet and locks the bond in the vault. */
export function openEscrow(orderId: string, customer: string, fundMinutes = 30) {
  return locked(orderId, async () => {
    const o = getOrder(orderId);
    if (!o) throw new Error('not found');
    if (!chain.DEP) throw new Error('Escrow payment is not switched on yet.');
    if (!isAddress(customer)) throw new Error('That is not a wallet address.');
    if (o.escrow) {
      if (o.escrow.customer.toLowerCase() === customer.toLowerCase() && o.escrow.state === 'Open') return o;
      throw new Error('This quote already has an escrow for another wallet. Get a new quote.');
    }
    if (o.status !== 'quoted' || o.quote.promo || o.quote.decision !== 'quote') throw new Error(`This quote can't be paid (${o.status}).`);
    if (Date.now() - Date.parse(o.createdAt) > 6 * 3600_000) throw new Error('This quote is more than 6 hours old. Get a new quote.');
    // Opening costs the CFO gas and locks a bond, so only for a wallet that can actually pay, and never too many at once.
    if (listOrders().filter((x) => x.escrow?.state === 'Open').length >= 5) throw new Error('Several unpaid escrows are open right now. Try again in a few minutes.');
    if (await blacklisted(customer)) throw new Error("This wallet is on Circle's USDC blacklist, so we can't take payment from it.");
    const has = await chain.usdcOf(customer as Address);
    if (has < o.quote.priceUsd) throw new Error(`This wallet has ${has.toFixed(2)} USDC; the job needs ${o.quote.priceUsd.toFixed(2)} USDC plus a few cents for gas.`);
    const free = await chain.refreshBondFree();
    if (free !== null && o.quote.bondUsd > free + 1e-9) throw new Error('The bond pool changed since your quote. Get a new quote.');
    const spec = specFor(o, customer as Address);
    const id = chain.jobKey(o.id), specHash = chain.hashText(spec);
    const now = await chain.chainNow(), fundBy = now + fundMinutes * 60, deliverBy = fundBy + Math.max(1, o.quote.deliverHours) * 3600;
    const r = await chain.openJob(id, customer as Address, o.quote.priceUsd, o.quote.bondUsd, specHash, fundBy, deliverBy);
    o.escrow = {
      id, customer: customer as Address, spec, specHash, fundBy: new Date(fundBy * 1000).toISOString(), deliverBy: new Date(deliverBy * 1000).toISOString(),
      state: 'Open', openTx: r.hash, openBlock: r.block.toString(),
    };
    saveOrder(o);
    void chain.refreshBondFree().catch(() => {});
    return o;
  });
}

/** Store a revision note ahead of the customer's on-chain request (the email on the order must match). */
/** Whether a request comes from the customer who placed the order: their order key, or for orders made before
 *  keys existed, the email on the order. */
export function isCustomer(o: Pick<Order, 'customerKey' | 'email'>, who: { key?: string | null; email?: string | null }): boolean {
  if (o.customerKey) return sameSecret(who.key, o.customerKey);
  return !!who.email && who.email.trim().toLowerCase() === o.email;
}
export const sameSecret = (a: string | null | undefined, b: string | undefined) => {
  if (!a || !b) return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
export const NOT_CUSTOMER = 'Only the customer who placed this order can do that. Open it from the link in your email.';

export function noteForRevision(o: Order, who: { key?: string | null; email?: string | null }, note: string) {
  if (!o.escrow || o.status !== 'delivered' || o.revisionNote !== undefined) return;
  if (!isCustomer(o, who)) throw new Error(NOT_CUSTOMER);
  o.pendingNote = note.slice(0, 800);
  saveOrder(o);
}

/**
 * Bring an escrow order in line with the chain, and do the CFO's part: start the work once funded,
 * submit each delivery, release after 48 h of silence, refund a failed job once its deadline passes,
 * and cancel a quote nobody funded. `tx` is a transaction the browser just sent (checked on-chain).
 */
export function syncEscrow(orderId: string, tx?: string) {
  return locked(orderId, async () => {
    let o = getOrder(orderId);
    if (!o?.escrow || !chain.DEP) return o;
    const e = o.escrow, from = BigInt(e.openBlock);
    const [c, now] = await Promise.all([chain.readEscrow(e.id), chain.chainNow()]);
    const theirs = async (ev: 'JobFunded' | 'RevisionRequested' | 'JobAccepted' | 'JobRejected') =>
      tx && (await chain.txEmitted(tx, ev, e.id)) ? (tx as Hex) : await chain.txOf(ev, e.id, from);
    e.state = c.state;

    if (o.status === 'quoted') {
      if (c.state === 'Funded') {
        e.fundTx = await theirs('JobFunded');
        saveOrder(o);
        await start(o, 'escrow', e.fundTx);
        return getOrder(orderId);
      }
      if (c.state === 'Open' && now > c.fundBy) {
        e.closeTx = (await chain.cancelUnfunded(e.id)).hash;
        e.state = 'Cancelled';
      }
      if (e.state === 'Cancelled') o.status = 'expired';
    } else if (o.status === 'delivered' && c.state === 'Funded' && c.revised && e.submitTx && o.revisionNote === undefined) {
      // the customer asked for their one revision on-chain
      e.submitTx = undefined;
      e.deliverBy = new Date(c.deliverBy * 1000).toISOString();
      const note = o.pendingNote;
      o.pendingNote = undefined;
      revise(o, note);
      return getOrder(orderId);
    } else if (o.status === 'delivered' && c.state === 'Funded' && !e.submitTx) {
      const last = readJob(o.runs[o.runs.length - 1]);
      e.deliverableHash = chain.hashText(last?.deliverable ?? '');
      e.submitTx = (await chain.submitJob(e.id, e.deliverableHash)).hash;
      const after = await chain.readEscrow(e.id);
      e.state = after.state;
      e.acceptBy = new Date(after.acceptBy * 1000).toISOString();
    } else if (o.status === 'delivered' && c.state === 'Submitted' && now > c.acceptBy) {
      e.closeTx = (await chain.autoRelease(e.id)).hash;
      e.state = 'Accepted';
      o.status = 'accepted';
      o.decision = { kind: 'accepted', at: new Date().toISOString(), by: 'auto' };
    } else if (c.state === 'Accepted' && o.status !== 'accepted') {
      e.closeTx = await theirs('JobAccepted');
      o.status = 'accepted';
      o.decision = { kind: 'accepted', at: new Date().toISOString(), by: 'customer' };
    } else if (c.state === 'Rejected' && o.status !== 'rejected') {
      e.closeTx = await theirs('JobRejected');
      const at = new Date().toISOString();
      o.status = 'rejected';
      o.decision = { kind: 'rejected', at, by: 'customer', note: o.pendingNote };
      o.refund = { priceUsd: o.quote.priceUsd, bondUsd: o.quote.bondUsd, at, tx: e.closeTx };
    } else if (['failed', 'queued', 'running', 'revision'].includes(o.status) && c.state === 'Funded' && now > c.deliverBy) {
      // not delivered by the deadline (or the run died with the server): refund plus the bond
      e.closeTx = (await chain.refundLate(e.id)).hash;
      e.state = 'Refunded';
      o.status = 'failed';
      o.refund = { priceUsd: o.quote.priceUsd, bondUsd: o.quote.bondUsd, at: new Date().toISOString(), tx: e.closeTx };
    }
    saveOrder(o);
    return o;
  });
}

/** Escrow orders the CFO still has something to do for, or is waiting on the chain for. */
export function escrowPending(): string[] {
  return listOrders().filter((o) => o.escrow && !['Accepted', 'Rejected', 'Refunded', 'Cancelled'].includes(o.escrow.state)).map((o) => o.id);
}
