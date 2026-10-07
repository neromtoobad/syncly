// Syncly Pay: the agents run a small business's own payments. Money in: invoices it sends its customers.
// Money out: bills it pays its suppliers. Both are booked on InvoiceBook on Arc, which fixes the payee, the
// exact amount and the hash of the invoice document, then lets the invoice be paid once, straight from
// payer to payee (Syncly takes 0.5%, booked with the invoice). The agents do the work around it:
//  - the Writer turns a sentence ("invoice Ada 50 USDC for 2 trays, due Friday") into an invoice
//  - the Analyst reads a photo of a supplier's invoice
//  - the Investigator checks the payee before anything is booked: Circle's USDC blacklist, a payout address
//    that changed since the last bill (the classic invoice fraud), a brand-new address, duplicates
//  - the CFO's key books the invoice; the Messenger sends it, chases it and sends the receipts
// A business proves it owns its email before anything is booked for it, and gets a private dashboard link.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { getAddress, isAddress, keccak256, parseAbi, parseEventLogs, toBytes, type Address, type Hex } from 'viem';
import { DATA_DIR, DRY, MODELS } from './config.ts';
import { DEP, cfoWrite, pub } from './escrow.ts';
import { Job } from './job.ts';
import { HOSTS, llm, parseJson } from './tools.ts';
import { blacklisted } from './payees.ts';
import { findingsFor, screeningSummary, type Watched } from './screen.ts';
import { MAILER, PUBLIC_URL, resend } from './mail.ts';
import { readUpload } from './uploads.ts';
import { record } from './cfo/log.ts';

export const NGN_PER_USD = 1330; // shown as an approximation only, like the site
const BOOK_ABI = parseAbi([
  'function book(bytes32 id, address payee, uint256 amount, uint64 due, bytes32 docHash)',
  'function cancel(bytes32 id)',
  'function feeBps() view returns (uint16)',
  'function invoices(bytes32) view returns (address payee, uint96 amount, address booker, uint64 due, uint16 feeBps, bool paid, bool cancelled, bytes32 docHash)',
  'event Paid(bytes32 indexed id, address indexed payer, address indexed payee, uint256 amount, uint256 fee)',
]);
const PAID = BOOK_ABI.find((x) => x.type === 'event' && x.name === 'Paid')!;
const VAULT = (DEP as any)?.payVault as Address | undefined;
const VAULT_ABI = parseAbi([
  'function accounts(bytes32) view returns (address owner, uint96 balance, uint96 perPayCap, uint96 weekCap, uint96 spent, uint64 weekStart)',
  'function allowed(bytes32, address) view returns (bool)',
  'function autopay(bytes32 biz, bytes32 invoice)',
  'function propose(bytes32 biz, bytes32 invoice, string reason)',
]);
/** A business's id in PayVault. */
export const bizKey = (bizId: string): Hex => keccak256(toBytes(bizId));
const BOOK = (DEP as any)?.invoiceBook as Address | undefined;
const FROM_BLOCK = BigInt((DEP as any)?.invoiceBookBlock ?? 0);
/** Live when InvoiceBook is deployed; in demo mode the chain is simulated so the flow can be tried. */
export const payMode = (): 'live' | 'demo' | 'off' => (BOOK ? 'live' : DRY ? 'demo' : 'off');
/** What the pay page needs to talk to the chain itself (the payer's wallet signs; the server only reads). */
export const payConfig = () => ({ mode: payMode(), book: BOOK ?? null, vault: VAULT ?? null, usdc: (DEP as any)?.usdc ?? null, chainId: (DEP as any)?.chainId ?? null, ngnPerUsd: NGN_PER_USD });

// ---------------------------------------------------------------- records

export type Flag = { level: 'ok' | 'warn' | 'stop'; text: string; override?: 'payee' | 'duplicate' };
export type Line = { what: string; qty: number; unitUsd: number };
type Supplier = { name: string; payee: Address; paid: number; totalUsd: number; lastPaidAt?: string };
export type Business = { id: string; name: string; email: string; payee: Address; pendingPayee?: Address; token: string; verified: boolean; code?: string; codeFor?: Address; createdAt: string; suppliers: Record<string, Supplier>; lastReportAt?: string; lastReportAsked?: string };
export type PayDoc = {
  id: string; key: Hex; kind: 'invoice' | 'bill'; biz: string;
  seller: { name: string; email?: string }; // who gets paid
  buyer: { name: string; email?: string }; // who pays
  payee: Address; amountUsd: number; lines: Line[]; due?: string; note?: string; ref?: string;
  doc: string; docHash: Hex; feeBps: number;
  status: 'confirm-email' | 'checking' | 'review' | 'booking' | 'open' | 'paid' | 'cancelled' | 'failed';
  checks?: Flag[]; upload?: string; read?: Record<string, unknown>;
  bookTx?: string; payTx?: string; payer?: string; paidAt?: string; feeUsd?: number;
  reminders: string[]; createdAt: string; jobId?: string; error?: string;
  autopay?: { state: 'scheduled' | 'paid' | 'proposed' | 'waiting-funds'; reason?: string; at?: string; tx?: string };
};

const dir = (k: 'biz' | 'docs') => { const d = join(DATA_DIR, 'pay', k); mkdirSync(d, { recursive: true }); return d; };
const ID = /^(inv|bill|biz)_[a-z0-9]{6,24}$/;
const read = <T>(k: 'biz' | 'docs', id: string): T | undefined => { const f = join(dir(k), `${id}.json`); return ID.test(id) && existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : undefined; };
const write = (k: 'biz' | 'docs', o: { id: string }) => writeFileSync(join(dir(k), `${o.id}.json`), JSON.stringify(o, null, 2));
const all = <T>(k: 'biz' | 'docs'): T[] => readdirSync(dir(k)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir(k), f), 'utf8')));
const newId = (p: string) => `${p}_${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
export const getDoc = (id: string) => read<PayDoc>('docs', id);
export const saveDoc = (d: PayDoc) => write('docs', d);
const getBiz = (id: string) => read<Business>('biz', id);
const bizByEmail = (email: string) => all<Business>('biz').find((b) => b.email === email);
export const bizByToken = (token: string) => (token && token.length >= 20 ? all<Business>('biz').find((b) => b.token === token) : undefined);
const usd = (n: number) => Math.round(n * 1e6) / 1e6;
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const cleanEmail = (e?: string) => { const x = String(e ?? '').trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x) ? x : undefined; };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The invoice text whose keccak256 is fixed on-chain: who is paid, by whom, for what, how much, by when. */
function sealDoc(d: Omit<PayDoc, 'doc' | 'docHash' | 'key'>): { doc: string; docHash: Hex } {
  const doc = JSON.stringify({
    syncly: 'invoice/v1', id: d.id, kind: d.kind, seller: d.seller.name, buyer: d.buyer.name, payee: d.payee,
    amountUSDC: d.amountUsd.toFixed(6), lines: d.lines.map((l) => [l.what, l.qty, l.unitUsd.toFixed(6)]), due: d.due ?? null, ref: d.ref ?? null, note: d.note ?? null,
  });
  return { doc, docHash: keccak256(toBytes(doc)) };
}

/** What anyone with the link sees: no emails, the payee shortened only in the UI. */
export function publicDoc(d: PayDoc) {
  const { biz: _b, upload: _u, read: _r, jobId: _j, reminders: _m, ...rest } = d;
  return { ...rest, seller: { name: d.seller.name }, buyer: { name: d.buyer.name }, book: BOOK ?? null, mode: payMode(), ngnPerUsd: NGN_PER_USD };
}

// ---------------------------------------------------------------- agents

const POLICY = { budgetUsd: 0.2, allowHosts: [HOSTS.blockrun] };
const today = () => new Date().toISOString().slice(0, 10);

/** The Writer turns a sentence into invoice lines. Amounts in USDC; naira is converted at the shown rate. */
async function writeInvoice(job: Job, text: string): Promise<{ customer?: { name?: string; email?: string }; lines: Line[]; due?: string; note?: string }> {
  job.log('writer', 'invoice', 'turning the description into invoice lines');
  const r = parseJson<any>(await llm(job, 'writer', [
    { role: 'system', content: `You turn a small business's description of a sale into an invoice. Today is ${today()}. Reply JSON only: {"customer":{"name":"","email":""},"lines":[{"what":"","qty":1,"unitUsd":0}],"due":"YYYY-MM-DD" or null,"note":""}. Amounts are USDC (1 USDC = 1 US dollar). If the text gives naira (₦, NGN, "k" meaning thousand naira), convert at ${NGN_PER_USD} naira per USDC, round to 2 decimals, and say the naira amount in note. Use only what the text says; never invent items, prices or emails.` },
    { role: 'user', content: text.slice(0, 1200) },
  ], 'write the invoice', { model: MODELS.fast, maxTokens: 500, json: true, maxUsd: 0.02,
    dry: () => JSON.stringify({ customer: { name: 'Ada' }, lines: [{ what: 'Party tray (20 guests)', qty: 2, unitUsd: 18.8 }], due: null, note: '' }) }), {});
  const lines = (Array.isArray(r.lines) ? r.lines : []).map((l: any) => ({ what: String(l.what ?? '').slice(0, 120), qty: Math.max(1, Math.round(Number(l.qty) || 1)), unitUsd: usd(Number(l.unitUsd) || 0) })).filter((l: Line) => l.what && l.unitUsd > 0).slice(0, 20);
  return { customer: r.customer, lines, due: /^\d{4}-\d{2}-\d{2}$/.test(r.due ?? '') ? r.due : undefined, note: r.note ? String(r.note).slice(0, 240) : undefined };
}

type BillRead = { readable: boolean; supplier?: { name?: string; email?: string; phone?: string }; invoiceNumber?: string; date?: string; due?: string; currency?: string; total?: number; lines?: { what: string; qty?: number; amount?: number }[]; payTo?: { evmAddress?: string; bank?: string; accountName?: string; accountNumber?: string } };

/** The Analyst reads a supplier's invoice off a photo or screenshot. Numbers are copied, never estimated. */
async function readBill(job: Job, img: Buffer): Promise<BillRead> {
  job.log('analyst', 'read', `reading the supplier's invoice with ${MODELS.vision.split('/')[1]}`);
  return parseJson<BillRead>(await llm(job, 'analyst', [
    { role: 'system', content: 'You read a supplier invoice, receipt or bill from a photo or screenshot. Copy names, numbers and addresses exactly as printed; leave a field out if it is not there. Never estimate or complete a number. Reply JSON only: {"readable":true|false,"supplier":{"name":"","email":"","phone":""},"invoiceNumber":"","date":"YYYY-MM-DD","due":"YYYY-MM-DD","currency":"ISO code or USDC","total":number,"lines":[{"what":"","qty":number,"amount":number}],"payTo":{"evmAddress":"0x… if a crypto address is printed","bank":"","accountName":"","accountNumber":""}}' },
    { role: 'user', content: [{ type: 'text', text: 'The bill:' }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${img.toString('base64')}` } }] },
  ], 'read the bill', { model: MODELS.vision, maxTokens: 600, json: true, maxUsd: 0.06,
    dry: () => JSON.stringify({ readable: true, supplier: { name: 'Mama Put Packaging Ltd', phone: '0803 000 1111' }, invoiceNumber: 'MP-0412', date: today(), currency: 'USDC', total: 42.5, lines: [{ what: 'Food boxes (200)', qty: 1, amount: 42.5 }], payTo: { evmAddress: '0x000000000000000000000000000000000000dEaD' } }) }), { readable: false });
}

/** The Investigator: everything worth knowing about a payee before money goes to it. */
async function checkBill(job: Job, biz: Business, d: PayDoc): Promise<Flag[]> {
  job.log('investigator', 'check', `checking the payee ${short(d.payee)} and ${d.seller.name}'s history with ${biz.name}`);
  const flags: Flag[] = [];
  if (await blacklisted(d.payee)) flags.push({ level: 'stop', text: "This address is on Circle's USDC blacklist. Don't pay it." });
  for (const f of findingsFor(d.payee)) flags.push({ level: f.level, text: `Screening: ${f.text}` });
  const sup = biz.suppliers[key(d.seller.name)];
  if (sup && sup.payee.toLowerCase() !== d.payee.toLowerCase()) {
    flags.push({ level: 'stop', override: 'payee', text: `${d.seller.name}'s payout address changed. You paid ${short(sup.payee)} ${sup.paid} time${sup.paid === 1 ? '' : 's'}; this bill says ${short(d.payee)}. Changed bank or wallet details are the most common invoice fraud: call ${d.seller.name} on a number you already have before paying.` });
  } else if (sup) {
    flags.push({ level: 'ok', text: `Same address you've paid ${d.seller.name} ${sup.paid} time${sup.paid === 1 ? '' : 's'} before (${sup.totalUsd.toFixed(2)} USDC in total).` });
  } else {
    flags.push({ level: 'warn', text: `First payment to ${d.seller.name} at ${short(d.payee)}. Check the address with them once; after this it is pinned to them.` });
  }
  try {
    if (!DRY) {
      const [nonce, code] = await Promise.all([pub.getTransactionCount({ address: d.payee }), pub.getCode({ address: d.payee })]);
      if (code && code !== '0x') flags.push({ level: 'warn', text: 'The payee is a contract, not a person or an exchange deposit address. Make sure the supplier meant it.' });
      else if (nonce === 0) flags.push({ level: 'ok', text: 'The address has never sent a transaction on Arc. Normal for an exchange deposit address (Bybit, Binance).' });
    }
  } catch { /* the chain lookup is advisory */ }
  const mine = all<PayDoc>('docs').filter((x) => x.biz === biz.id && x.kind === 'bill' && x.id !== d.id && x.status !== 'cancelled' && x.status !== 'failed');
  const twin = mine.find((x) => x.docHash === d.docHash || (d.ref && x.ref === d.ref && key(x.seller.name) === key(d.seller.name)));
  if (twin) flags.push({ level: 'stop', override: 'duplicate', text: `Looks like a duplicate of a bill from ${twin.createdAt.slice(0, 10)} (${twin.ref ? `invoice ${twin.ref}, ` : ''}${twin.amountUsd.toFixed(2)} USDC, ${twin.status}). Paying the same invoice twice is the second most common loss.` });
  else {
    const near = mine.find((x) => x.payee.toLowerCase() === d.payee.toLowerCase() && Math.abs(x.amountUsd - d.amountUsd) < 0.005 && Date.now() - Date.parse(x.createdAt) < 30 * 86400_000);
    if (near) flags.push({ level: 'warn', text: `You had a bill for the same amount to the same address on ${near.createdAt.slice(0, 10)}. Make sure this is a new order.` });
  }
  const past = mine.filter((x) => x.status === 'paid' && key(x.seller.name) === key(d.seller.name)).map((x) => x.amountUsd).sort((a, b) => a - b);
  if (past.length >= 2 && d.amountUsd > 3 * past[Math.floor(past.length / 2)]) flags.push({ level: 'warn', text: `${d.amountUsd.toFixed(2)} USDC is over 3× what you usually pay ${d.seller.name} (${past[Math.floor(past.length / 2)].toFixed(2)}).` });
  job.log('investigator', 'verdict', flags.some((f) => f.level === 'stop') ? 'stop: needs you before it can be paid' : flags.some((f) => f.level === 'warn') ? 'pay after a quick check' : 'clear');
  return flags;
}

// ---------------------------------------------------------------- chain

async function bookOnChain(d: PayDoc) {
  d.status = 'booking'; saveDoc(d);
  try {
    if (BOOK) {
      d.feeBps = Number(await pub.readContract({ address: BOOK, abi: BOOK_ABI, functionName: 'feeBps' }));
      const due = d.due ? Math.floor(Date.parse(`${d.due}T23:59:59Z`) / 1000) : 0;
      const r = await cfoWrite(BOOK, BOOK_ABI, 'book', [d.key, d.payee, BigInt(Math.round(d.amountUsd * 1e6)), BigInt(due), d.docHash]);
      d.bookTx = r.hash;
    } else d.bookTx = `demo-${randomBytes(8).toString('hex')}`;
    d.status = 'open';
  } catch (e: any) {
    d.status = 'failed'; d.error = `Booking on Arc failed: ${String(e?.shortMessage ?? e?.message ?? e).split('\n')[0]}`;
  }
  saveDoc(d);
  if (d.status === 'open' && d.kind === 'invoice' && d.buyer.email) await sendInvoice(d).catch(() => {});
  if (d.status === 'open' && d.kind === 'bill') await planAutopay(d).catch((e) => console.error(`autopay ${d.id}: ${e?.message ?? e}`));
  return d;
}

// ---------------------------------------------------------------- autopay: the CFO pays inside the owner's on-chain rules

export type VaultAccount = { owner: Address; balanceUsd: number; perPayCapUsd: number; weekCapUsd: number; spentUsd: number; weekEnds: string };
export async function vaultAccount(bizId: string): Promise<VaultAccount | null> {
  if (!VAULT) return null;
  const a = await pub.readContract({ address: VAULT, abi: VAULT_ABI, functionName: 'accounts', args: [bizKey(bizId)] });
  if (a[0] === '0x0000000000000000000000000000000000000000') return null;
  const weekEnd = (Number(a[5]) + 7 * 86400) * 1000, rolled = Date.now() >= weekEnd;
  return { owner: a[0], balanceUsd: Number(a[1]) / 1e6, perPayCapUsd: Number(a[2]) / 1e6, weekCapUsd: Number(a[3]) / 1e6, spentUsd: rolled ? 0 : Number(a[4]) / 1e6, weekEnds: new Date(rolled ? Date.now() + 7 * 86400_000 : weekEnd).toISOString() };
}

/** A bill was booked for a business with autopay: pay it on its due date, or now if it's due. */
async function planAutopay(d: PayDoc) {
  if (!VAULT || !(await vaultAccount(d.biz))) return;
  const dueAt = d.due ? Date.parse(`${d.due}T00:00:00Z`) : 0;
  if (dueAt > Date.now()) { d.autopay = { state: 'scheduled', at: d.due }; saveDoc(d); return; }
  await runAutopay(d);
}

/**
 * The CFO's decision for one bill. Inside the rules (an approved supplier, under the per-payment and the
 * weekly cap, money in the account) it pays from the business's PayVault balance; outside them it can only
 * propose, and the owner decides from their wallet. Either way the decision is signed into the CFO's log.
 */
export async function runAutopay(d: PayDoc) {
  if (!VAULT || d.status !== 'open' || d.kind !== 'bill') return;
  const acct = await vaultAccount(d.biz);
  if (!acct) return;
  const biz = getBiz(d.biz);
  const name = biz?.name ?? 'the business';
  const ok = await pub.readContract({ address: VAULT, abi: VAULT_ABI, functionName: 'allowed', args: [bizKey(d.biz), d.payee] });
  const inputs = { business: name, supplier: d.seller.name, amountUsd: d.amountUsd, perPayCapUsd: acct.perPayCapUsd, weekCapUsd: acct.weekCapUsd, spentThisWeekUsd: acct.spentUsd, balanceUsd: acct.balanceUsd, approvedSupplier: ok, invoice: d.id };
  const screened = findingsFor(d.payee);
  const reason = screened.length ? (screened.some((f) => f.level === 'stop') ? `screening found ${d.seller.name}'s address on a blacklist` : `screening found ${d.seller.name}'s address trading with a blacklisted one`)
    : !ok ? `${d.seller.name} isn't an approved supplier for autopay`
    : d.amountUsd > acct.perPayCapUsd ? `${d.amountUsd.toFixed(2)} USDC is over the ${acct.perPayCapUsd.toFixed(2)} USDC per-payment cap`
      : acct.spentUsd + d.amountUsd > acct.weekCapUsd ? `it would pass the weekly cap (${acct.spentUsd.toFixed(2)} of ${acct.weekCapUsd.toFixed(2)} USDC used)`
        : undefined;
  if (!reason && d.amountUsd > acct.balanceUsd) {
    // inside the rules, but the account is short: wait for a top-up (once in the log, then quietly)
    if (d.autopay?.state !== 'waiting-funds') {
      d.autopay = { state: 'waiting-funds', reason: `the autopay balance is ${acct.balanceUsd.toFixed(2)} USDC` }; saveDoc(d);
      await record({ kind: 'escalate', summary: `${name}'s bill from ${d.seller.name} (${d.amountUsd.toFixed(2)} USDC) is due, inside its rules, but its autopay balance is ${acct.balanceUsd.toFixed(2)} USDC. Waiting for a top-up.`, rule: 'never pay more than the business deposited', inputs, key: `autopay-funds:${d.id}`, status: 'escalated' });
      await mail(biz?.email, `Top up autopay to pay ${d.seller.name}`, [`${d.seller.name}'s bill for ${d.amountUsd.toFixed(2)} USDC is due and inside your autopay rules, but the autopay balance is ${acct.balanceUsd.toFixed(2)} USDC.`, `Add money on your desk: ${biz ? deskLink(biz) : link(d)}`]).catch(() => {});
    }
    return;
  }
  if (!reason) {
    const r = await cfoWrite(VAULT, VAULT_ABI, 'autopay', [bizKey(d.biz), d.key]);
    d.autopay = { state: 'paid', at: new Date().toISOString(), tx: r.hash }; saveDoc(d);
    await record({ kind: 'autopay', summary: `Paid ${d.seller.name} ${d.amountUsd.toFixed(2)} USDC for ${name} from its autopay balance: an approved supplier, under the ${acct.perPayCapUsd.toFixed(2)} USDC per-payment cap, ${(acct.spentUsd + d.amountUsd).toFixed(2)} of ${acct.weekCapUsd.toFixed(2)} USDC used this week.`, rule: "pay approved suppliers inside the owner's on-chain caps", inputs, key: `autopay:${d.id}`, amount: d.amountUsd, tx: r.hash, status: 'done' });
    await syncPaid(d, { tx: r.hash });
    return;
  }
  const r = await cfoWrite(VAULT, VAULT_ABI, 'propose', [bizKey(d.biz), d.key, reason]);
  d.autopay = { state: 'proposed', reason, at: new Date().toISOString(), tx: r.hash }; saveDoc(d);
  await record({ kind: 'pay-propose', summary: `Asked ${name} to approve paying ${d.seller.name} ${d.amountUsd.toFixed(2)} USDC: ${reason}.`, rule: 'outside the owner\'s rules, the CFO can only propose', inputs, key: `pay-propose:${d.id}`, amount: d.amountUsd, tx: r.hash, status: 'escalated' });
  await mail(biz?.email, `Approve: ${d.seller.name}, ${d.amountUsd.toFixed(2)} USDC`, [`The CFO didn't pay ${d.seller.name}'s bill automatically because ${reason}.`, `Approve it (or don't) from your wallet on your desk: ${biz ? deskLink(biz) : link(d)}`]).catch(() => {});
}

/** Read the chain; mark the invoice paid with the payer, fee and transaction. Returns true if it is paid. */
export async function syncPaid(d: PayDoc, opts: { tx?: string; demoPayer?: string } = {}): Promise<boolean> {
  if (d.status !== 'open') return d.status === 'paid';
  if (!BOOK) {
    if (!opts.demoPayer) return false;
    Object.assign(d, { status: 'paid', payer: opts.demoPayer, payTx: `demo-${randomBytes(8).toString('hex')}`, paidAt: new Date().toISOString(), feeUsd: usd((d.amountUsd * d.feeBps) / 10_000) });
  } else {
    // the chain decides: the invoice must be marked paid on InvoiceBook
    const inv = await pub.readContract({ address: BOOK, abi: BOOK_ABI, functionName: 'invoices', args: [d.key] });
    if (!inv[5]) return false;
    let ev: any;
    if (opts.tx && /^0x[0-9a-fA-F]{64}$/.test(opts.tx)) {
      const r = await pub.getTransactionReceipt({ hash: opts.tx as Hex }).catch(() => undefined);
      ev = r && parseEventLogs({ abi: BOOK_ABI, logs: r.logs }).find((l: any) => l.eventName === 'Paid' && l.args.id === d.key);
    }
    if (!ev) {
      const latest = await pub.getBlockNumber().catch(() => FROM_BLOCK);
      const from = latest > FROM_BLOCK + 90_000n ? latest - 90_000n : FROM_BLOCK;
      ev = (await pub.getLogs({ address: BOOK, event: PAID as any, args: { id: d.key } as any, fromBlock: from, toBlock: 'latest' }).catch(() => []))[0];
    }
    Object.assign(d, { status: 'paid', payer: ev?.args.payer, payTx: ev?.transactionHash, paidAt: new Date().toISOString(), feeUsd: ev ? Number(ev.args.fee) / 1e6 : usd((d.amountUsd * d.feeBps) / 10_000) });
  }
  saveDoc(d);
  if (d.kind === 'bill') {
    const biz = getBiz(d.biz);
    if (biz) {
      const k = key(d.seller.name), s = biz.suppliers[k];
      biz.suppliers[k] = { name: d.seller.name, payee: d.payee, paid: (s?.paid ?? 0) + 1, totalUsd: usd((s?.totalUsd ?? 0) + d.amountUsd), lastPaidAt: d.paidAt };
      write('biz', biz);
    }
  }
  await sendReceipts(d).catch(() => {});
  return true;
}

// ---------------------------------------------------------------- email (the Messenger)

const link = (d: PayDoc) => `${PUBLIC_URL}/pay/${d.id}`;
const deskLink = (b: Business) => `${PUBLIC_URL}/pay/desk/${b.token}`;
async function mail(to: string | undefined, subject: string, lines: string[]) {
  if (!to || MAILER !== 'resend') return;
  const text = lines.join('\n\n');
  const html = `<div style="font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#13271C;max-width:560px;margin:0 auto;padding:24px">${lines.map((l) => `<p style="margin:0 0 14px;line-height:1.55">${l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/(https?:\/\/\S+)/g, '<a href="$1" style="color:#2E7A38">$1</a>')}</p>`).join('')}<p style="color:#66726A;font-size:13px">Syncly Pay · payments booked on Arc, in USDC</p></div>`;
  await resend({ to, subject: subject.replace(/\s+/g, ' ').slice(0, 140), text, html });
}
const sendInvoice = (d: PayDoc) => mail(d.buyer.email, `Invoice from ${d.seller.name}: ${d.amountUsd.toFixed(2)} USDC`, [
  `Hi ${d.buyer.name}, ${d.seller.name} sent you an invoice for ${d.amountUsd.toFixed(2)} USDC (≈ ₦${Math.round(d.amountUsd * NGN_PER_USD).toLocaleString('en-NG')})${d.due ? `, due ${d.due}` : ''}.`,
  ...d.lines.map((l) => `· ${l.qty} × ${l.what}: ${(l.qty * l.unitUsd).toFixed(2)} USDC`),
  `Pay it here, in USDC on Arc: ${link(d)}`,
  `The payee and amount are fixed on-chain, so this link can only ever pay ${d.seller.name}, and only once.`,
]);
async function sendReceipts(d: PayDoc) {
  const biz = getBiz(d.biz);
  const tx = d.payTx && !d.payTx.startsWith('demo') ? ` Transaction: https://explorer.arc.io/tx/${d.payTx}` : '';
  if (d.kind === 'invoice') {
    await mail(biz?.email, `Paid: ${d.buyer.name} paid ${d.amountUsd.toFixed(2)} USDC`, [`${d.buyer.name} paid your invoice: ${d.amountUsd.toFixed(2)} USDC. You received ${(d.amountUsd - (d.feeUsd ?? 0)).toFixed(2)} USDC at ${short(d.payee)} after the 0.5% fee.${tx}`, `Your books: ${biz ? deskLink(biz) : link(d)}`]);
    await mail(d.buyer.email, `Receipt from ${d.seller.name}`, [`You paid ${d.seller.name} ${d.amountUsd.toFixed(2)} USDC. Thank you.${tx}`, `Receipt: ${link(d)}`]);
  } else {
    await mail(biz?.email, `Bill paid: ${d.amountUsd.toFixed(2)} USDC to ${d.seller.name}`, [`You paid ${d.seller.name} ${d.amountUsd.toFixed(2)} USDC, once, to ${short(d.payee)}. Their address is now pinned: a bill with a different address will be stopped.${tx}`, `Your books: ${biz ? deskLink(biz) : link(d)}`]);
  }
}

// ---------------------------------------------------------------- the business

/** Find or create the business for an email. A new or changed payout address needs the owner to confirm by email. */
function upsertBusiness(input: { name: string; email: string; payee: Address }): Business {
  let b = bizByEmail(input.email);
  if (!b) {
    b = { id: newId('biz'), name: input.name, email: input.email, payee: input.payee, token: randomBytes(18).toString('base64url'), verified: false, createdAt: new Date().toISOString(), suppliers: {} };
  } else if (b.payee.toLowerCase() !== input.payee.toLowerCase()) {
    b.pendingPayee = input.payee; // the address on file keeps paying until the owner confirms the new one by email
  } else delete b.pendingPayee;
  if (!b.verified) b.name = input.name || b.name;
  write('biz', b);
  return b;
}
/** A business asks for its desk (to pay bills) before sending any invoice: the owner confirms by email. */
export async function registerBusiness(input: { name: string; email: string; payee: string }) {
  if (payMode() === 'off') throw new Error('Syncly Pay is switching on shortly. Try again soon.');
  const email = cleanEmail(input.email), name = String(input.name ?? '').trim().slice(0, 80);
  if (!email || !name) throw new Error('Add your business name and email.');
  if (!isAddress(String(input.payee ?? '').trim())) throw new Error('Add your Arc address (your Bybit "Deposit → USDC → Arc" address works).');
  const payee = getAddress(String(input.payee).trim());
  if (await blacklisted(payee)) throw new Error("That address is on Circle's USDC blacklist.");
  const b = upsertBusiness({ name, email, payee });
  const url = confirmLink(b, payee);
  await mail(b.email, `Your Syncly Pay desk for ${b.name}`, [`Confirm ${b.name} on Syncly Pay, paid at ${b.pendingPayee ?? b.payee}: ${url}`, 'Your desk is where you send invoices and pay bills; the agents check every payee before money moves.']);
  if (MAILER !== 'resend' || DRY) console.log(`pay: confirm ${b.name} at ${url}`);
  return { sent: true };
}

/** A confirm link is for one payout address: the address named in that email, and no other. Asking for a different
 *  address makes a new code, so an older link can never confirm an address someone else typed in since. */
function confirmLink(b: Business, payee: Address): string {
  if (!b.code || b.codeFor?.toLowerCase() !== payee.toLowerCase()) { b.code = randomBytes(12).toString('base64url'); b.codeFor = payee; }
  write('biz', b);
  return `${PUBLIC_URL}/pay/confirm?b=${b.id}&c=${b.code}`;
}
async function askToConfirm(b: Business, pending: PayDoc) {
  const url = confirmLink(b, pending.payee);
  await mail(b.email, `Confirm your invoice to ${pending.buyer.name} on Syncly Pay`, [`Someone (hopefully you) asked Syncly Pay to send an invoice from ${b.name} for ${pending.amountUsd.toFixed(2)} USDC to ${pending.buyer.name}, to be paid to this address: ${pending.payee}`, `If that's you and that's your address, confirm here: ${url}`, `Nothing is booked or sent until you confirm. You'll also get a private link to your invoices and bills: use it next time and invoices go out straight away.`]);
  if (MAILER !== 'resend' || DRY) console.log(`pay: confirm ${b.name} at ${url}`);
  return url;
}
/** The owner clicked the link: the business is verified and everything waiting on it is booked. */
export async function confirmBusiness(id: string, code: string) {
  const b = getBiz(id);
  if (!b || !b.code || !b.codeFor || b.code !== code) throw new Error('This link has expired or was already used.');
  // the address this link was sent for, not whatever was typed in since
  const confirmed = b.codeFor;
  b.payee = confirmed;
  if (b.pendingPayee?.toLowerCase() === confirmed.toLowerCase()) delete b.pendingPayee;
  b.verified = true; delete b.code; delete b.codeFor; write('biz', b);
  for (const d of all<PayDoc>('docs').filter((x) => x.biz === b.id && x.status === 'confirm-email' && x.payee?.toLowerCase() === confirmed.toLowerCase())) {
    d.payee = b.payee; Object.assign(d, sealDoc(d)); await bookOnChain(d);
  }
  return { desk: `/pay/desk/${b.token}`, name: b.name };
}

// ---------------------------------------------------------------- invoices (money in)

export type NewInvoice = { business: { name: string; email: string; payee: string }; customer?: { name?: string; email?: string }; lines?: Line[]; text?: string; due?: string; note?: string; token?: string };
export async function createInvoice(input: NewInvoice) {
  if (payMode() === 'off') throw new Error('Syncly Pay is switching on shortly. Try again soon.');
  const email = cleanEmail(input.business?.email);
  const name = String(input.business?.name ?? '').trim().slice(0, 80);
  if (!email || !name) throw new Error('Add your business name and email.');
  if (!isAddress(String(input.business?.payee ?? '').trim())) throw new Error('Add the Arc address you want to be paid at (your Bybit "Deposit → USDC → Arc" address works).');
  const payee = getAddress(String(input.business.payee).trim());
  if (await blacklisted(payee)) throw new Error("That address is on Circle's USDC blacklist and can't receive payments.");
  // Only the business's private desk link books straight away; the public form waits for an email confirmation,
  // so nobody can send invoices in a business's name or point its payments somewhere else.
  const viaDesk = input.token ? bizByToken(input.token) : undefined;
  const b = viaDesk?.verified ? viaDesk : upsertBusiness({ name, email, payee });
  const trusted = !!viaDesk?.verified;

  const id = newId('inv');
  const job = new Job('pay', `Invoice for ${name}`, POLICY);
  let lines = (input.lines ?? []).map((l) => ({ what: String(l.what ?? '').slice(0, 120), qty: Math.max(1, Math.round(Number(l.qty) || 1)), unitUsd: usd(Number(l.unitUsd) || 0) })).filter((l) => l.what && l.unitUsd > 0);
  let customer = { name: String(input.customer?.name ?? '').trim().slice(0, 80), email: cleanEmail(input.customer?.email) };
  let due = /^\d{4}-\d{2}-\d{2}$/.test(input.due ?? '') ? input.due : undefined;
  let note = input.note ? String(input.note).slice(0, 240) : undefined;
  if (!lines.length && input.text?.trim()) {
    const w = await writeInvoice(job, input.text);
    lines = w.lines; due ??= w.due; note ??= w.note;
    customer = { name: customer.name || String(w.customer?.name ?? '').slice(0, 80), email: customer.email ?? cleanEmail(w.customer?.email) };
  }
  if (!lines.length) throw new Error('Say what the invoice is for and how much, e.g. "2 party trays at 18.80 USDC each".');
  const amountUsd = usd(lines.reduce((a, l) => a + l.qty * l.unitUsd, 0));
  if (amountUsd < 0.1 || amountUsd > 50_000) throw new Error('Invoices are between 0.10 and 50,000 USDC.');

  const pay_to = trusted ? b.payee : (b.pendingPayee ?? b.payee);
  const base = { id, key: keccak256(toBytes(id)), kind: 'invoice' as const, biz: b.id, seller: { name: b.name, email: b.email }, buyer: { name: customer.name || 'Customer', email: customer.email }, payee: pay_to, amountUsd, lines, due, note, feeBps: 50, reminders: [], createdAt: new Date().toISOString(), jobId: job.id };
  const d: PayDoc = { ...base, ...sealDoc(base as any), status: trusted ? 'booking' : 'confirm-email' };
  saveDoc(d);
  job.log('cfo', 'book', trusted ? `booking ${amountUsd.toFixed(2)} USDC on Arc, payee ${short(pay_to)}` : `waiting for ${b.name} to confirm by email before booking`);
  job.status = 'delivered'; job.deliverable = d.doc; job.save();
  if (trusted) await bookOnChain(d);
  else await askToConfirm(b, d);
  return { doc: getDoc(d.id)!, confirm: !trusted, desk: trusted ? `/pay/desk/${b.token}` : undefined };
}

// ---------------------------------------------------------------- bills (money out)

/** A verified business uploads a supplier's invoice; the agents read it and check the payee. */
export async function createBill(input: { token: string; upload: string; payee?: string; note?: string }) {
  if (payMode() === 'off') throw new Error('Syncly Pay is switching on shortly. Try again soon.');
  const b = bizByToken(input.token);
  if (!b || !b.verified) throw new Error('Open your Syncly Pay link first (we email it when you send your first invoice).');
  const img = readUpload(input.upload);
  if (!img) throw new Error('Upload a photo or screenshot of the bill.');
  const id = newId('bill');
  const job = new Job('pay', `Bill for ${b.name}`, POLICY);
  const d = { id, key: keccak256(toBytes(id)), kind: 'bill', biz: b.id, seller: { name: 'Supplier' }, buyer: { name: b.name, email: b.email }, payee: b.payee, amountUsd: 0, lines: [], feeBps: 50, status: 'checking', upload: input.upload, reminders: [], createdAt: new Date().toISOString(), jobId: job.id, doc: '', docHash: '0x' } as PayDoc;
  saveDoc(d);
  void (async () => {
    try {
      const r = await readBill(job, img);
      d.read = r as any;
      const flags: Flag[] = [];
      if (!r.readable || !(Number(r.total) > 0)) { d.status = 'review'; d.checks = [{ level: 'stop', text: "The bill couldn't be read clearly. Upload a sharper photo or a screenshot of it." }]; saveDoc(d); return; }
      const cur = String(r.currency ?? 'USD').toUpperCase();
      d.amountUsd = cur === 'NGN' ? usd(Math.round((Number(r.total) / NGN_PER_USD) * 100) / 100) : usd(Number(r.total));
      if (cur === 'NGN') flags.push({ level: 'warn', text: `The bill is in naira (₦${Number(r.total).toLocaleString('en-NG')}); converted at ₦${NGN_PER_USD} per USDC to ${d.amountUsd.toFixed(2)} USDC. Agree the USDC amount with the supplier.` });
      else if (!['USD', 'USDC'].includes(cur)) flags.push({ level: 'warn', text: `The bill is in ${cur}; check the USDC amount with the supplier.` });
      d.seller = { name: String(r.supplier?.name ?? 'Supplier').slice(0, 80), email: cleanEmail(r.supplier?.email) };
      d.ref = r.invoiceNumber ? String(r.invoiceNumber).slice(0, 40) : undefined;
      d.due = /^\d{4}-\d{2}-\d{2}$/.test(r.due ?? '') ? r.due : undefined;
      d.note = input.note ? String(input.note).slice(0, 240) : undefined;
      d.lines = (r.lines?.length ? r.lines : [{ what: `Invoice ${d.ref ?? ''}`.trim(), amount: Number(r.total) }]).slice(0, 20).map((l) => ({ what: String(l.what ?? 'Item').slice(0, 120), qty: 1, unitUsd: cur === 'NGN' ? usd((Number(l.amount) || 0) / NGN_PER_USD) : usd(Number(l.amount) || 0) }));
      const printed = r.payTo?.evmAddress && isAddress(r.payTo.evmAddress) ? getAddress(r.payTo.evmAddress) : undefined;
      const given = input.payee && isAddress(input.payee.trim()) ? getAddress(input.payee.trim()) : undefined;
      const pinned = b.suppliers[key(d.seller.name)]?.payee;
      const payee = given ?? printed ?? pinned;
      if (given && printed && given.toLowerCase() !== printed.toLowerCase()) flags.push({ level: 'stop', override: 'payee', text: `The address you typed (${short(given)}) isn't the one printed on the bill (${short(printed)}).` });
      if (!payee) { d.status = 'review'; d.checks = [...flags, { level: 'stop', text: `No Arc address for ${d.seller.name} on the bill. Ask them for their USDC address on Arc (an exchange deposit address works) and add it.` }]; saveDoc(d); return; }
      d.payee = payee;
      Object.assign(d, sealDoc(d));
      d.checks = [...flags, ...(await checkBill(job, b, d))];
      d.status = 'review';
      job.status = 'delivered'; job.deliverable = d.doc; job.save();
    } catch (e: any) {
      d.status = 'failed'; d.error = String(e?.message ?? e).split('\n')[0];
    }
    saveDoc(d);
  })();
  return d;
}

/** The owner approves a checked bill: it's booked on Arc and ready to pay from their wallet. */
export async function approveBill(id: string, input: { token: string; confirmPayee?: boolean; notDuplicate?: boolean; payee?: string }) {
  const d = getDoc(id), b = bizByToken(input.token);
  if (!d || d.kind !== 'bill' || !b || d.biz !== b.id) throw new Error('Not your bill.');
  if (d.status !== 'review') throw new Error(`This bill is ${d.status}.`);
  if (input.payee && isAddress(input.payee.trim()) && getAddress(input.payee.trim()) !== d.payee) {
    // a corrected address is checked again from the start
    d.payee = getAddress(input.payee.trim()); Object.assign(d, sealDoc(d));
    const job = new Job('pay', `Bill for ${b.name} (new address)`, POLICY);
    d.checks = await checkBill(job, b, d); saveDoc(d);
    return d;
  }
  const blocking = (d.checks ?? []).filter((f) => f.level === 'stop' && !((f.override === 'payee' && input.confirmPayee) || (f.override === 'duplicate' && input.notDuplicate)));
  if (blocking.length) throw new Error(blocking[0].text);
  return bookOnChain(d);
}

export function cancelDoc(id: string, token: string) {
  const d = getDoc(id), b = bizByToken(token);
  if (!d || !b || d.biz !== b.id) throw new Error('Not yours.');
  if (d.status === 'paid') throw new Error('It is already paid.');
  d.status = 'cancelled'; saveDoc(d);
  if (BOOK && d.bookTx && !d.bookTx.startsWith('demo')) void cfoWrite(BOOK, BOOK_ABI, 'cancel', [d.key]).catch(() => {});
  return d;
}

// ---------------------------------------------------------------- the business's desk and books

/** Every address a business deals with: its own payout address, its suppliers, who paid it, and payees on open bills. */
const dealsWith = (b: Business, docs: PayDoc[]) => [b.payee, ...Object.values(b.suppliers).map((s) => s.payee), ...docs.filter((d) => d.kind === 'invoice' && d.payer).map((d) => d.payer!), ...docs.filter((d) => d.kind === 'bill' && ['review', 'open'].includes(d.status)).map((d) => d.payee)]
  .filter((a, i, xs) => xs.findIndex((x) => x.toLowerCase() === a.toLowerCase()) === i);

export async function desk(token: string) {
  const b = bizByToken(token);
  if (!b) throw new Error('This link is not valid.');
  const docs = all<PayDoc>('docs').filter((d) => d.biz === b.id).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  const sum = (k: PayDoc['kind'], st: PayDoc['status'][]) => usd(docs.filter((d) => d.kind === k && st.includes(d.status)).reduce((a, d) => a + d.amountUsd, 0));
  return {
    business: { name: b.name, email: b.email, payee: b.payee, verified: b.verified },
    totals: { paidIn: sum('invoice', ['paid']), owedToYou: sum('invoice', ['open']), paidOut: sum('bill', ['paid']), toPay: sum('bill', ['open', 'review']), fees: usd(docs.filter((d) => d.status === 'paid' && d.kind === 'invoice').reduce((a, d) => a + (d.feeUsd ?? 0), 0)) },
    suppliers: Object.values(b.suppliers),
    biz: bizKey(b.id),
    docs: docs.map((d) => ({ ...publicDoc(d), buyer: d.buyer, seller: d.seller, upload: d.upload })),
    mode: payMode(),
    screening: screeningSummary(dealsWith(b, docs)),
    autopay: VAULT ? await (async () => {
      const account = await vaultAccount(b.id).catch(() => null);
      const allowed: Record<string, boolean> = {};
      if (account) for (const sp of Object.values(b.suppliers)) allowed[sp.payee] = await pub.readContract({ address: VAULT, abi: VAULT_ABI, functionName: 'allowed', args: [bizKey(b.id), sp.payee] }).catch(() => false);
      return { vault: VAULT, account, allowed };
    })() : null,
  };
}
// ---------------------------------------------------------------- the CFO's weekly report

const money = (n: number) => n.toFixed(2);
const dueAt = (d: PayDoc) => (d.due ? Date.parse(`${d.due}T23:59:59Z`) : undefined);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** Everything a small business's CFO would tell it on a Monday: the week's money, who owes, what's due, and whether autopay can cover it. */
export async function weeklyReport(b: Business) {
  const now = Date.now(), weekAgo = now - 7 * 86400_000, ahead = now + 7 * 86400_000;
  const docs = all<PayDoc>('docs').filter((d) => d.biz === b.id);
  const sum = (xs: PayDoc[]) => usd(xs.reduce((t, d) => t + d.amountUsd, 0));
  const inWeek = docs.filter((d) => d.kind === 'invoice' && d.status === 'paid' && Date.parse(d.paidAt ?? '') > weekAgo);
  const outWeek = docs.filter((d) => d.kind === 'bill' && d.status === 'paid' && Date.parse(d.paidAt ?? '') > weekAgo);
  const overdue = docs.filter((d) => d.kind === 'invoice' && d.status === 'open' && (dueAt(d) ?? Infinity) < now).sort((x, y) => dueAt(x)! - dueAt(y)!);
  const comingIn = docs.filter((d) => d.kind === 'invoice' && d.status === 'open' && (dueAt(d) ?? now) >= now && (dueAt(d) ?? now) <= ahead);
  const goingOut = docs.filter((d) => d.kind === 'bill' && ['open', 'review'].includes(d.status) && (dueAt(d) ?? now) <= ahead);
  const waiting = docs.filter((d) => d.kind === 'bill' && d.status === 'open' && d.autopay?.state === 'proposed');
  const acct = await vaultAccount(b.id).catch(() => null);
  const autopaid = outWeek.filter((d) => d.autopay?.state === 'paid').length;
  const net = usd(sum(inWeek) - sum(outWeek)), fwd = usd(sum(comingIn) - sum(goingOut));
  const fees = usd(inWeek.reduce((t, d) => t + (d.feeUsd ?? 0), 0));
  const lines: string[] = [
    `Hi ${b.name}, here is your week in Syncly Pay, from your CFO.`,
    `Last 7 days: ${money(sum(inWeek))} USDC in from ${plural(inWeek.length, 'invoice')}, ${money(sum(outWeek))} USDC out on ${plural(outWeek.length, 'bill')}${autopaid ? ` (${autopaid} paid by autopay)` : ''}. Net ${net >= 0 ? '+' : '−'}${money(Math.abs(net))} USDC.`,
  ];
  if (overdue.length) lines.push(`Overdue: ${overdue.slice(0, 5).map((d) => `${d.buyer.name} owes ${money(d.amountUsd)} USDC, ${Math.max(1, Math.floor((now - dueAt(d)!) / 86400_000))} days late`).join('; ')}${overdue.length > 5 ? `, and ${overdue.length - 5} more` : ''}. The Messenger has been reminding them; a call from you usually works faster.`);
  lines.push(`Next 7 days: ${money(sum(comingIn))} USDC due in from ${plural(comingIn.length, 'invoice')} and ${money(sum(goingOut))} USDC due out on ${plural(goingOut.length, 'bill')}, so ${fwd >= 0 ? '+' : '−'}${money(Math.abs(fwd))} USDC if everyone pays on time.`);
  if (acct) {
    const inRules = goingOut.filter((d) => d.status === 'open' && d.autopay?.state !== 'proposed');
    const need = usd(sum(inRules) - acct.balanceUsd);
    lines.push(`Autopay holds ${money(acct.balanceUsd)} USDC (at most ${money(acct.perPayCapUsd)} per bill, ${money(acct.weekCapUsd)} a week). ${inRules.length ? (need > 0 ? `The bills it will pay next week come to ${money(sum(inRules))}: add ${money(need)} USDC so none of them waits.` : `That covers the ${money(sum(inRules))} USDC of bills it will pay next week.`) : 'No bills for it to pay next week.'}`);
  }
  if (waiting.length) lines.push(`Waiting for you: ${waiting.map((d) => `${d.seller.name}, ${money(d.amountUsd)} USDC (${d.autopay?.reason})`).join('; ')}. Approve or cancel on your desk.`);
  const scr = screeningSummary(dealsWith(b, docs));
  lines.push(scr.findings.length ? `Screening found ${plural(scr.findings.length, 'problem')}: ${scr.findings.map((f) => f.text).join(' ')}` : `Screening: everyone you paid or were paid by is checked daily against Circle's USDC blacklist. Nothing found.`);
  if (fees > 0) lines.push(`Syncly's fee this week: ${money(fees)} USDC (0.5% of what you were paid).`);
  lines.push(`Your desk, with every invoice, bill and on-chain receipt: ${deskLink(b)}`);
  const subject = `Your week: ${net >= 0 ? '+' : '−'}${money(Math.abs(net))} USDC${overdue.length ? `, ${plural(overdue.length, 'invoice')} overdue` : ''}${waiting.length ? `, ${waiting.length} waiting for you` : ''}`;
  return { subject, lines, figures: { in: sum(inWeek), out: sum(outWeek), net, overdue: overdue.length, comingIn: sum(comingIn), goingOut: sum(goingOut), waiting: waiting.length, findings: scr.findings.length } };
}

async function sendReport(b: Business, why: 'weekly' | 'asked') {
  if (MAILER !== 'resend') throw new Error("Email isn't switched on here yet.");
  const r = await weeklyReport(b);
  await mail(b.email, r.subject, r.lines);
  b[why === 'weekly' ? 'lastReportAt' : 'lastReportAsked'] = new Date().toISOString(); write('biz', b);
  await record({ kind: 'report', summary: `Sent ${b.name} its ${why === 'weekly' ? 'weekly' : 'requested'} report: ${money(r.figures.in)} in, ${money(r.figures.out)} out${r.figures.overdue ? `, ${r.figures.overdue} overdue` : ''}${r.figures.waiting ? `, ${r.figures.waiting} waiting for it` : ''}.`, rule: 'every Pay business hears from its CFO each Monday', inputs: { business: b.name, ...r.figures }, key: `report:${b.id}:${new Date().toISOString().slice(0, 10)}`, status: 'done' });
  return r;
}
/** The desk previews this week's report, and can have it emailed now (once an hour). */
export async function reportFor(token: string, send = false) {
  const b = bizByToken(token);
  if (!b || !b.verified) throw new Error('This link is not valid.');
  if (!send) return weeklyReport(b);
  if (b.lastReportAsked && Date.now() - Date.parse(b.lastReportAsked) < 3600_000) throw new Error('Sent within the last hour. Check your inbox (and spam).');
  return sendReport(b, 'asked');
}
/** Monday 07:00 UTC (08:00 in Lagos): each business with any activity gets its week. */
async function weeklyReports() {
  const d = new Date(), slot = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7), 7));
  if (Date.now() < slot.getTime() || Date.now() - slot.getTime() > 24 * 3600_000 || MAILER !== 'resend') return; // Mondays only
  const active = new Set(all<PayDoc>('docs').map((x) => x.biz));
  for (const b of all<Business>('biz').filter((x) => x.verified && active.has(x.id) && Date.parse(x.lastReportAt ?? '1970') < slot.getTime())) {
    await sendReport(b, 'weekly').catch((e) => console.error(`report ${b.id}: ${e?.message ?? e}`));
  }
}

export async function booksCsv(token: string) {
  const { docs } = await desk(token);
  const q = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const rows = docs.map((d) => [d.createdAt.slice(0, 10), d.kind === 'invoice' ? 'money in' : 'money out', d.kind === 'invoice' ? d.buyer.name : d.seller.name, d.ref ?? d.id, d.amountUsd.toFixed(2), (d.feeUsd ?? 0).toFixed(4), d.status, d.paidAt?.slice(0, 10) ?? '', d.payTx ?? '', d.payee].map(q).join(','));
  return ['date,direction,counterparty,reference,amount_usdc,fee_usdc,status,paid_on,arc_tx,payee', ...rows].join('\n') + '\n';
}

/** Everyone Pay businesses deal with, for daily screening: their payout addresses, suppliers, payers, and payees on open bills. */
export function payWatchlist(): Watched[] {
  const out: Watched[] = [];
  for (const b of all<Business>('biz').filter((x) => x.verified)) {
    out.push({ address: b.payee, label: `${b.name}'s payout address`, role: 'business', biz: b.id });
    for (const s of Object.values(b.suppliers)) out.push({ address: s.payee, label: `${s.name}, supplier to ${b.name},`, role: 'supplier', biz: b.id });
  }
  for (const d of all<PayDoc>('docs')) {
    if (d.kind === 'invoice' && d.payer) out.push({ address: d.payer as Address, label: `${d.buyer.name}, who paid ${d.seller.name},`, role: 'payer', biz: d.biz });
    if (d.kind === 'bill' && ['review', 'open'].includes(d.status)) out.push({ address: d.payee, label: `${d.seller.name}, on a bill to ${d.buyer.name},`, role: 'supplier', biz: d.biz });
  }
  return out;
}

// ---------------------------------------------------------------- the tick: payments seen on-chain, reminders

let ticking = false;
export async function payTick() {
  if (ticking || payMode() === 'off') return;
  ticking = true;
  try {
    for (const d of all<PayDoc>('docs').filter((x) => x.status === 'open')) {
      if (BOOK) await syncPaid(d).catch(() => {});
      if (d.status === 'open' && d.kind === 'bill' && (d.autopay?.state === 'waiting-funds' || (d.autopay?.state === 'scheduled' && (!d.due || Date.parse(`${d.due}T00:00:00Z`) <= Date.now())))) {
        await runAutopay(d).catch((e) => console.error(`autopay ${d.id}: ${e?.message ?? e}`));
      }
      if (d.status !== 'open' || d.kind !== 'invoice' || !d.buyer.email || !d.due) continue;
      // the Messenger chases politely: the day before it's due, on the day, and three days late (once each)
      const left = (Date.parse(`${d.due}T23:59:59Z`) - Date.now()) / 86400_000;
      const stage = left <= -3 ? 'late' : left <= 0 ? 'due' : left <= 1 ? 'soon' : undefined;
      if (stage && !d.reminders.includes(stage)) {
        d.reminders.push(stage); saveDoc(d);
        await mail(d.buyer.email, `${stage === 'late' ? 'Overdue' : stage === 'due' ? 'Due today' : 'Due tomorrow'}: ${d.seller.name}, ${d.amountUsd.toFixed(2)} USDC`, [`Hi ${d.buyer.name}, a reminder that ${d.seller.name}'s invoice for ${d.amountUsd.toFixed(2)} USDC ${stage === 'late' ? `was due on ${d.due}` : stage === 'due' ? 'is due today' : 'is due tomorrow'}.`, `Pay it here: ${link(d)}`]).catch(() => {});
      }
    }
    await weeklyReports();
  } finally { ticking = false; }
}
