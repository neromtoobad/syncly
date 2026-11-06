// Referrals (the Canteen team's idea): every customer whose work was accepted gets a promo code. A new customer who
// orders with it gets that job free, and the moment they accept it, the customer who shared the code earns a free job
// too. Only the codes are stored (data/referrals.json, code → email); free jobs earned and used are counted from the
// orders themselves, so nothing can be counted twice.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomInt } from 'node:crypto';
import { DATA_DIR, DRY } from './config.ts';
import { listOrders, type Order } from './orders.ts';

type Store = Record<string, { email: string; at: string }>;
const FILE = () => join(DATA_DIR, DRY ? 'referrals.demo.json' : 'referrals.json');
const load = (): Store => (existsSync(FILE()) ? JSON.parse(readFileSync(FILE(), 'utf8')) : {});
function save(s: Store) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE() + '.tmp', JSON.stringify(s, null, 2));
  renameSync(FILE() + '.tmp', FILE());
}

/** What a customer types: case, spaces and dashes don't matter. */
export const cleanCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);

/** Free jobs from referrals get their own tool budget: REFERRAL_WEEKLY_USD a rolling week (default 5 USDC). */
export const REFERRAL_WEEKLY_USD = Number(process.env.REFERRAL_WEEKLY_USD ?? 5);

const mine = () => listOrders().filter((o) => o.demo === DRY);
/** A free job counts as used once it starts, unless we failed to deliver it (the same rule as the free first job). */
const usedFree = (o: Order) => o.payment?.mode === 'promo' && o.status !== 'failed';

export function ownerOf(code: string): string | undefined {
  return load()[cleanCode(code)]?.email;
}
export function codeOf(email: string): string | undefined {
  const e = email.trim().toLowerCase();
  return Object.entries(load()).find(([, v]) => v.email === e)?.[0];
}

/** Customers with accepted work get a code: the business name's first letters and two digits, e.g. LYDIAS27. */
export function issueCode(email: string): string | undefined {
  const e = email.trim().toLowerCase();
  const had = codeOf(e);
  if (had) return had;
  const orders = mine().filter((o) => o.email === e);
  if (!orders.some((o) => o.status === 'accepted')) return undefined;
  const name = orders.map((o) => String((o.details as any)?.name ?? '')).find(Boolean) ?? '';
  const stem = cleanCode(name).replace(/[0-9]/g, '').slice(0, 6) || 'SYNCLY';
  const store = load();
  let code = '';
  for (let i = 0; i < 50 && (!code || store[code]); i++) code = `${stem}${randomInt(10, 100)}`;
  if (store[code]) code = `${stem}${randomInt(100, 1000)}`;
  store[code] = { email: e, at: new Date().toISOString() };
  save(store);
  return code;
}

/** Free jobs a customer has earned (friends who ordered with their code and accepted) and not used yet. */
export function creditsOf(email: string, except?: string) {
  const e = email.trim().toLowerCase();
  const code = codeOf(e);
  const orders = mine();
  const earned = code ? orders.filter((o) => o.referral?.kind === 'invited' && o.referral.code === code && o.status === 'accepted').length : 0;
  const used = orders.filter((o) => o.id !== except && o.email === e && o.referral?.kind === 'reward' && usedFree(o)).length;
  const pending = code ? orders.filter((o) => o.referral?.kind === 'invited' && o.referral.code === code && usedFree(o) && o.status !== 'accepted' && o.status !== 'rejected').length : 0;
  return { code, earned, used, left: Math.max(0, earned - used), pending };
}

/** A new customer is an email that has never started a job (free or paid). */
export const isNewCustomer = (email: string, except?: string) => !mine().some((o) => o.id !== except && o.email === email.trim().toLowerCase() && !!o.payment);

/** Tool spend still free for referral jobs this week. */
export function referralLeftUsd(): number {
  const since = Date.now() - 7 * 86400_000;
  const used = mine().filter((o) => o.referral && usedFree(o) && Date.parse(o.payment!.at) > since).reduce((s, o) => s + o.quote.estCostUsd, 0);
  return Math.max(0, REFERRAL_WEEKLY_USD - used);
}

/**
 * Which free job, if any, a referral gives this quote. A code (from a friend) makes a new customer's job free; with no
 * code, a free job the customer earned by referring is used. `note` explains a code that couldn't be used.
 */
export function referralFor(email: string, code?: string): { kind: 'invited' | 'reward'; code: string; why: string } | { note: string } | undefined {
  const e = email.trim().toLowerCase();
  const c = code ? cleanCode(code) : '';
  if (c) {
    const owner = ownerOf(c);
    if (!owner) return { note: `There's no promo code ${c}. Check it with the friend who sent it.` };
    if (owner === e) return { note: "That's your own code: share it with other businesses, and you get a free job each time one of them accepts their work." };
    if (!isNewCustomer(e)) return { note: `Promo code ${c} is for businesses ordering from Syncly for the first time.` };
    return { kind: 'invited', code: c, why: `Free with promo code ${c}: your first job is on us, and the friend who sent it earns a free job when you accept` };
  }
  const mineNow = creditsOf(e);
  if (mineNow.left > 0 && mineNow.code) return { kind: 'reward', code: mineNow.code, why: `Free: you earned it when a business you referred with code ${mineNow.code} accepted their work` };
  return undefined;
}

/** Just before a free referral job starts: is it still allowed? (Two quotes can't both use one free job.) */
export function stillValid(o: Order): string | undefined {
  if (!o.referral) return;
  if (o.referral.kind === 'invited') return isNewCustomer(o.email, o.id) ? undefined : 'This email has already started a job, so the promo code no longer applies. Get a new quote.';
  return creditsOf(o.email, o.id).left > 0 ? undefined : 'Your free referral job has already been used. Get a new quote.';
}

/** For the owner: every code, whose it is, and what it has earned. */
export function referralReport() {
  for (const e of new Set(mine().filter((o) => o.status === 'accepted').map((o) => o.email))) issueCode(e);
  const orders = mine();
  return Object.entries(load()).map(([code, v]) => {
    const name = orders.filter((o) => o.email === v.email).map((o) => String((o.details as any)?.name ?? '')).find(Boolean) ?? '';
    return { code, email: v.email, name, ...creditsOf(v.email), invited: orders.filter((o) => o.referral?.kind === 'invited' && o.referral.code === code).map((o) => ({ id: o.id, status: o.status })) };
  });
}
