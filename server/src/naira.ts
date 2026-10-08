// Pay in naira: a customer without a wallet pays a job's naira price through Bachs (bank transfer or a Nigerian
// card), and NairaDesk, a USDC float on Arc the Boss keeps topped up, funds that job's escrow. From there the job
// runs like any paid job: escrow, bond, CFO, agents paying for tools on Arc. The customer decides on the job page
// (the email on the order must match), and the CFO's key relays it through the desk, which is the escrow's
// customer. A rejection refunds the naira through Bachs; the price and bond come back to the float on Arc.
//
// Safety: the desk contract only pays Syncly's own escrow, once per Bachs checkout, under per-payment and daily
// caps. A payment is only acted on after a signed webhook AND a fresh look-up of the checkout at Bachs, matched to
// the order, the currency and the amount. Customers buy a service priced in naira; nobody can buy USDC here.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { keccak256, toBytes, type Hex } from 'viem';
import { DATA_DIR } from './config.ts';
import * as chain from './escrow.ts';
import { getOrder, isCustomer, listOrders, NOT_CUSTOMER, openEscrow, saveOrder, syncEscrow, type Order } from './orders.ts';
import { PUBLIC_URL } from './mail.ts';
import { record } from './cfo/log.ts';

const KEY = process.env.BACHS_API_KEY?.trim();
const SECRET = process.env.BACHS_WEBHOOK_SECRET?.trim();
const BASE = (process.env.BACHS_API_URL?.trim() || (KEY?.startsWith('sk_live_') ? 'https://api.bachs.io' : 'https://sandbox-api.bachs.io')).replace(/\/$/, '');
export const NAIRA_LIVE = !!KEY?.startsWith('sk_live_');
// Bachs takes 1.5% of a bank transfer (capped at ₦2,000) out of what we receive; the rest covers FX drift between
// collecting naira and refilling the float with USDC.
const MARGIN = Number(process.env.NAIRA_MARGIN ?? 0.035);
const FUND_MINUTES = 120; // a bank transfer can take a while; the bond stays locked meanwhile

// On Arc mainnet only a live Bachs key counts: with a sandbox key, test cards would get real jobs funded from the float.
const ON_MAINNET = (process.env.OUTLAY_ESCROW_NET ?? 'arc') === 'arc' && chain.DEP?.network === 'arc';
export const nairaReady = () => !!KEY && !!SECRET && !!chain.deskAddress() && (!ON_MAINNET || NAIRA_LIVE);

async function bachs<T = any>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method, headers: { authorization: `Bearer ${KEY}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Bachs ${r.status}: ${j?.message ?? j?.error?.message ?? j?.error_code ?? j?.detail ?? 'request failed'}`);
  return j as T;
}

// ---------------------------------------------------------------- the naira price

let rateCache: { ngnPerUsd: number; at: number; from: string } | null = null;
/** Naira per US dollar: NAIRA_PER_USD when set, otherwise a fresh Bachs conversion quote (cached 15 min). */
export async function ngnPerUsd(): Promise<{ ngnPerUsd: number; from: string } | null> {
  const fixed = Number(process.env.NAIRA_PER_USD);
  if (fixed > 100) return { ngnPerUsd: fixed, from: 'NAIRA_PER_USD' };
  if (rateCache && Date.now() - rateCache.at < 15 * 60_000) return rateCache;
  if (!KEY) return null;
  try {
    const q = await bachs('POST', '/v1/conversions/quotes', { from_currency: 'USD', to_currency: 'NGN', amount: '100.00' });
    const to = Number(q.to_amount ?? q.target_amount ?? q.converted_amount), from = Number(q.from_amount ?? q.amount ?? 100);
    const rate = to > 0 && from > 0 ? to / from : Number(q.exchange_rate ?? q.rate);
    if (!(rate > 100)) throw new Error(`unexpected quote ${JSON.stringify(q).slice(0, 120)}`);
    rateCache = { ngnPerUsd: rate, at: Date.now(), from: 'Bachs conversion quote' };
    return rateCache;
  } catch (e: any) {
    console.error('  naira rate:', String(e?.message ?? e).slice(0, 160));
    return rateCache; // a stale rate beats none; with no rate at all, naira is off
  }
}
const naira = (usd: number, rate: number) => Math.ceil((usd * rate * (1 + MARGIN)) / 50) * 50; // rounded up to ₦50

/** What the order page shows: whether naira is open for this order, and its price. */
export async function nairaQuote(o: Order) {
  if (!nairaReady()) return { enabled: false as const, why: 'Paying in naira is not switched on yet.' };
  const [rate, desk] = await Promise.all([ngnPerUsd(), chain.readDesk().catch(() => null)]);
  if (!rate) return { enabled: false as const, why: "We can't get a naira rate right now. Try again in a few minutes." };
  const usd = o.quote.priceUsd;
  if (!desk || desk.floatUsd < usd || usd > desk.perPayCapUsd || usd > desk.dayLeftUsd) return { enabled: false as const, why: 'Naira payments are paused for today. Pay in USDC, or try again tomorrow.' };
  return { enabled: true as const, ngn: o.naira?.status === 'open' ? o.naira.ngn : naira(usd, rate.ngnPerUsd), rate: rate.ngnPerUsd };
}

// ---------------------------------------------------------------- starting a naira payment

/** Open the escrow for the desk and a Bachs checkout for the naira price; returns where to send the customer. */
export async function startNaira(orderId: string): Promise<{ url: string; ngn: number }> {
  let o = getOrder(orderId);
  if (!o) throw new Error('not found');
  if (o.status !== 'quoted' || o.quote.promo || o.quote.decision !== 'quote') throw new Error(`This quote can't be paid (${o.status}).`);
  const desk = chain.deskAddress();
  if (o.escrow && o.escrow.customer.toLowerCase() !== desk?.toLowerCase()) throw new Error('This quote is being paid from a wallet. Get a new quote to pay in naira.');
  // reuse a checkout that is still open
  if (o.naira?.status === 'open') {
    const c = await bachs('GET', `/v1/checkout-sessions/${o.naira.checkoutId}`).catch(() => null);
    if (c && String(c.status).toLowerCase() === 'open') return { url: o.naira.checkoutUrl, ngn: o.naira.ngn };
  }
  const q = await nairaQuote(o);
  if (!q.enabled) throw new Error(q.why);
  o = await openEscrow(o.id, desk!, FUND_MINUTES);
  const c = await bachs('POST', '/v1/checkout-sessions', {
    pricing: { currency: 'NGN', amount: q.ngn.toFixed(2) },
    customer: { email: o.email },
    reference: `${o.id}-${Date.now().toString(36)}`, // unique per attempt; the order is in metadata
    metadata: { order: o.id, service: o.service, usdc: o.quote.priceUsd.toFixed(2) },
    success_url: `${PUBLIC_URL}/job/${o.id}?paid=naira`,
    cancel_url: `${PUBLIC_URL}/hire/${o.service}`,
  });
  if (!c?.checkout_id || !c?.checkout_url) throw new Error('Bachs did not return a checkout.');
  o = getOrder(o.id)!;
  o.naira = { checkoutId: c.checkout_id, checkoutUrl: c.checkout_url, ngn: q.ngn, rate: q.rate, createdAt: new Date().toISOString(), status: 'open' };
  saveOrder(o);
  return { url: c.checkout_url, ngn: q.ngn };
}

// ---------------------------------------------------------------- Bachs webhooks

/** Bachs signs `${timestamp}.${raw body}` with HMAC-SHA256; V2 can carry several signatures during a rotation. */
export function verifyBachs(raw: string, headers: (name: string) => string | undefined, now = Date.now()): boolean {
  if (!SECRET) return false;
  let ts: string | undefined, sigs: string[] = [];
  const v2 = headers('x-bachs-signature-v2');
  if (v2) {
    for (const part of v2.split(',')) { const [k, v] = part.split('=', 2); if (k?.trim() === 't') ts = v?.trim(); else if (k?.trim() === 'v1' && v) sigs.push(v.trim()); }
  } else { ts = headers('x-bachs-timestamp'); const s = headers('x-bachs-signature'); if (s) sigs = [s.trim()]; }
  if (!ts || !sigs.length || Math.abs(now / 1000 - Number(ts)) > 300) return false;
  const want = createHmac('sha256', SECRET).update(`${ts}.${raw}`).digest('hex');
  return sigs.some((s) => s.length === want.length && timingSafeEqual(Buffer.from(s), Buffer.from(want)));
}

const seenFile = () => { const d = join(DATA_DIR, 'bachs'); mkdirSync(d, { recursive: true }); return join(d, 'events.jsonl'); };
const seen = (id: string) => existsSync(seenFile()) && readFileSync(seenFile(), 'utf8').includes(`"${id}"`);
const findByCheckout = (checkoutId: string) => listOrders().find((x) => x.naira?.checkoutId === checkoutId);
const usd = (n: number) => n.toFixed(2);

/** Handle one verified Bachs event. Idempotent: a repeated event, or a second event for a paid order, does nothing. */
export async function onBachsEvent(ev: { id?: string; type?: string; data?: any }): Promise<string> {
  const id = String(ev.id ?? ''), type = String(ev.type ?? ''), d = ev.data ?? {};
  if (id && seen(id)) return 'already handled';
  const checkoutId = String(d.checkout_id ?? '');
  let o = (d.metadata?.order && getOrder(String(d.metadata.order))) || (checkoutId ? findByCheckout(checkoutId) : undefined);
  let out = 'ignored';
  if (o?.naira && (!checkoutId || o.naira.checkoutId === checkoutId)) {
    if (type === 'collection.succeeded' || type === 'checkout.completed') out = await confirmPaid(o.id, d);
    else if (type === 'collection.underpaid') out = await underpaid(o.id, d);
    else if (type === 'checkout.expired') out = await expired(o.id);
    else if (type.startsWith('refund.')) {
      o = getOrder(o.id)!;
      if (o.naira?.refund) { o.naira.refund.status = type === 'refund.paid' ? 'paid' : type === 'refund.failed' ? 'failed' : o.naira.refund.status; o.naira.status = type === 'refund.paid' ? 'refunded' : type === 'refund.failed' ? 'refund-failed' : o.naira.status; saveOrder(o); }
      out = type;
    }
  }
  if (id) appendFileSync(seenFile(), JSON.stringify({ id, type, at: new Date().toISOString(), order: o?.id ?? null, out }) + '\n');
  return out;
}

const locks = new Set<string>();
async function once<T>(key: string, f: () => Promise<T>): Promise<T | 'busy'> {
  if (locks.has(key)) return 'busy';
  locks.add(key);
  try { return await f(); } finally { locks.delete(key); }
}

/** Money arrived: check it at Bachs, then fund the escrow from the float (or refund if the quote lapsed). */
async function confirmPaid(orderId: string, d: any): Promise<string> {
  const r = await once(`pay:${orderId}`, async () => {
    let o = getOrder(orderId)!;
    const n = o.naira!;
    if (n.status !== 'open' && n.status !== 'underpaid') return `already ${n.status}`;
    // never trust the event alone: look the checkout up at Bachs
    const c = await bachs('GET', `/v1/checkout-sessions/${n.checkoutId}`);
    const status = String(c.status ?? '').toLowerCase();
    if (status === 'open' || status === 'expired') return `checkout still ${status}`;
    if (c.metadata?.order && c.metadata.order !== o.id) throw new Error('checkout belongs to another order');
    const currency = String(d.currency ?? c.currency ?? '').toUpperCase();
    const paid = Number(d.settlement_amount ?? d.amount ?? c.amount);
    if (currency !== 'NGN' || !(paid >= n.ngn - 1)) throw new Error(`amount or currency mismatch: ${paid} ${currency} for ₦${n.ngn}`);
    n.chargeId = String(d.charge_id ?? c.payment_id ?? c.charge_id ?? '') || undefined;
    n.paidAt = new Date().toISOString(); n.paidNgn = paid; n.method = d.payment_method ?? c.payment_method;
    const esc = o.escrow ? await chain.readEscrow(o.escrow.id) : null;
    const ref = keccak256(toBytes(n.checkoutId));
    // Already funded by this very payment (an earlier attempt landed on-chain but didn't get saved): the job is paid
    // for, so record it and let the job run. Refunding here would give the naira back while the work goes ahead.
    if (esc && esc.state !== 'Open' && o.escrow && (await chain.deskRefFor(o.escrow.id as `0x${string}`).catch(() => null))?.toLowerCase() === ref.toLowerCase()) {
      o = getOrder(orderId)!;
      o.naira = { ...o.naira!, ...n, status: 'paid' };
      saveOrder(o);
      await syncEscrow(o.id);
      return 'paid earlier: job follows the chain';
    }
    if (!esc || esc.state !== 'Open') {
      // the quote lapsed before the money landed: give the naira back rather than start a job nobody funded
      n.status = 'late';
      saveOrder(o);
      await refundNaira(o.id, `Your payment for order ${o.id} arrived after the quote expired, so we've refunded it.`);
      return 'late: refunded';
    }
    const tx = (await chain.deskFund(o.escrow!.id, ref)).hash;
    o = getOrder(orderId)!;
    o.naira = { ...o.naira!, ...n, status: 'paid', fundTx: tx };
    saveOrder(o);
    await record({ kind: 'naira', summary: `Paid ${usd(o.quote.priceUsd)} USDC from the naira float into the escrow for ₦${n.ngn.toLocaleString('en-NG')} a customer paid through Bachs.`, rule: 'the float pays only Syncly’s escrow, once per naira payment, inside its caps', inputs: { order: o.id, checkout: n.checkoutId, ngn: n.ngn, rate: n.rate, paidNgn: paid }, key: `naira:${o.id}`, amount: o.quote.priceUsd, tx, status: 'done' }).catch(() => {});
    await syncEscrow(o.id); // sees Funded and starts the job
    return 'paid: job started';
  });
  return String(r);
}

async function underpaid(orderId: string, d: any): Promise<string> {
  const o = getOrder(orderId)!;
  if (o.naira!.status !== 'open') return `already ${o.naira!.status}`;
  o.naira!.status = 'underpaid';
  o.naira!.paidNgn = Number(d.amount_paid ?? d.settlement_amount ?? 0) || undefined;
  o.naira!.chargeId = String(d.charge_id ?? '') || undefined;
  saveOrder(o);
  await refundNaira(o.id, `You paid less than the order's price, so the job didn't start. We've refunded what you sent.`).catch(() => {});
  return 'underpaid: refunded';
}

async function expired(orderId: string): Promise<string> {
  const o = getOrder(orderId)!;
  if (o.naira!.status !== 'open') return `already ${o.naira!.status}`;
  o.naira!.status = 'expired';
  saveOrder(o);
  if (o.escrow?.state === 'Open') {
    try { o.escrow.closeTx = (await chain.cancelUnfunded(o.escrow.id)).hash; o.escrow.state = 'Cancelled'; o.status = 'expired'; saveOrder(o); } catch { /* the escrow tick cancels it at its deadline */ }
  }
  return 'expired';
}

/** Refund the customer's naira through Bachs (the whole payment, or `ngn` of it). */
async function refundNaira(orderId: string, reason: string, bondNgn = 0): Promise<void> {
  const o = getOrder(orderId)!;
  const n = o.naira!;
  if (!n.chargeId) throw new Error('No Bachs charge to refund.');
  const amount = n.paidNgn ?? n.ngn;
  n.refund = { ngn: amount, at: new Date().toISOString(), status: 'requested', ...(bondNgn ? { bondNgn } : {}) };
  n.status = 'refunding';
  saveOrder(o);
  try {
    const r = await bachs('POST', '/v1/refunds', { charge_id: n.chargeId, reference: `refund-${o.id}`, reason: reason.slice(0, 200) });
    const o2 = getOrder(orderId)!;
    o2.naira!.refund = { ...o2.naira!.refund!, id: r.refund_id ?? r.id, status: String(r.status ?? 'pending').toLowerCase() };
    saveOrder(o2);
  } catch (e) {
    const o2 = getOrder(orderId)!;
    o2.naira!.status = 'refund-failed';
    o2.naira!.refund = { ...o2.naira!.refund!, status: 'failed' };
    saveOrder(o2);
    throw e;
  }
}

// ---------------------------------------------------------------- the customer's decision

/**
 * Accept, ask for the one revision, or reject a delivered naira job. The email on the order must match; the
 * CFO's key relays the decision through the desk. A rejection refunds the naira; the bond, owed in naira too, is
 * recorded for a bank payout.
 */
export async function nairaDecide(orderId: string, who: { key?: string | null; email?: string | null }, action: 'accept' | 'revise' | 'reject', note?: string) {
  const o = getOrder(orderId);
  if (!o?.naira || !o.escrow) throw new Error('This order was not paid in naira.');
  if (!isCustomer(o, who)) throw new Error(NOT_CUSTOMER);
  if (o.status !== 'delivered' || o.escrow.state !== 'Submitted') throw new Error('There is nothing to decide on this order right now.');
  if (action === 'revise') {
    if (o.revisionNote !== undefined) throw new Error('This order already had its free revision.');
    o.pendingNote = (note ?? '').slice(0, 800);
    saveOrder(o);
    await chain.deskDecide('requestRevision', o.escrow.id);
  } else if (action === 'accept') {
    await chain.deskDecide('accept', o.escrow.id);
  } else {
    o.pendingNote = (note ?? '').slice(0, 800) || undefined;
    saveOrder(o);
    await chain.deskDecide('reject', o.escrow.id);
    await refundNaira(o.id, 'You rejected the work, so your payment is refunded in full.', Math.round(o.quote.bondUsd * o.naira.rate)).catch((e) =>
      record({ kind: 'naira', summary: `Rejected order ${o.id}: the price and bond came back to the float on Arc, but the naira refund through Bachs failed (${String(e?.message ?? e).slice(0, 100)}). The Boss needs to refund it by hand.`, rule: 'a rejected naira job is refunded in naira', inputs: { order: o.id }, key: `naira-refund-failed:${o.id}`, status: 'escalated' }));
  }
  return syncEscrow(o.id);
}

/** After an escrow sync: a paid naira job that missed its deadline was refunded to the float on Arc; refund the naira. */
export async function nairaFollowUp(orderId: string) {
  const o = getOrder(orderId);
  if (!o?.naira || o.naira.status !== 'paid' || o.escrow?.state !== 'Refunded') return;
  await refundNaira(o.id, 'We missed the delivery deadline, so your payment is refunded in full.', Math.round(o.quote.bondUsd * o.naira.rate)).catch((e) =>
    record({ kind: 'naira', summary: `Order ${o.id} missed its deadline: the price and bond came back to the float, but the naira refund through Bachs failed (${String(e?.message ?? e).slice(0, 100)}). The Boss needs to refund it by hand.`, rule: 'a refunded naira job is refunded in naira', inputs: { order: o.id }, key: `naira-refund-failed:${o.id}`, status: 'escalated' }));
}

/** For the CFO desk and the books: the float and today's room. */
export async function nairaStatus() {
  const desk = await chain.readDesk().catch(() => null);
  const rate = nairaReady() ? await ngnPerUsd() : null;
  const orders = listOrders().filter((x) => x.naira);
  return {
    enabled: nairaReady(), live: NAIRA_LIVE, desk, ngnPerUsd: rate?.ngnPerUsd ?? null,
    paid: orders.filter((x) => ['paid', 'refunding', 'refunded'].includes(x.naira!.status)).length,
    receivedNgn: orders.filter((x) => x.naira!.paidAt).reduce((t, x) => t + (x.naira!.paidNgn ?? x.naira!.ngn), 0),
  };
}
