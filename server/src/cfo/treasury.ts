// The CFO's money loop. Each tick it reads the vault's five buckets, every agent's Gateway balance
// and the work of the past week; decides by fixed rules what the company's money should do; does it
// within the vault's on-chain limits; and writes each decision, with what it saw, to the signed log.
// Anything beyond what it may do alone becomes an on-chain proposal the Boss co-signs.
// No language model touches money: every number here is computed, and every reason is printed.
//
//   OUTLAY_CFO=live     acts
//   OUTLAY_CFO=observe  (default) decides and logs what it would do, sends nothing
import { keccak256, parseAbi, toBytes, type Address, type Hex } from 'viem';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, DRY } from '../config.ts';
import { account, hasSeed, type Role } from '../wallets.ts';
import { DEP, cfoAddress, cfoWrite, pub } from '../escrow.ts';
import { gateway } from '../x402.ts';
import { MAIL } from '../mail.ts';
import { CATALOG } from '../services/index.ts';
import { listOrders, readJob } from '../orders.ts';
import { bus } from '../bus.ts';
import { decisions, loggedWithin, record, type DecisionKind } from './log.ts';
import { SPEND } from './spend.ts';

export const MODE = process.env.OUTLAY_CFO === 'live' ? 'live' : 'observe';

export const POLICY = {
  tickMinutes: 10,
  epochDays: 7, // allowances are planned a week at a time
  minJobsPerWeek: 5, // plan for at least this much work, even in a quiet week
  jobsAhead: 3, // fund each agent for this many of its usual jobs (and at least 1.5 jobs of its most expensive service)
  lowWaterJobs: 2, // top an agent up when it can afford fewer than this many jobs
  minFloat: 0.05, // smallest float worth planning for an agent that pays for anything
  bondTarget: 3, // bond cover to hold: two jobs at the top bond (30% of a 5 USDC job)
  cfoGasMin: 0.01, // below this the CFO can't send transactions; tell the Boss
  dust: 0.01, // ignore amounts smaller than this
};
// Spend per job before there is history: model calls and searches are about a cent or two.
// The Verifier retired on 2026-10-01; the Investigator does all the checking now.
const PAYING: Role[] = ['researcher', 'scout', 'reader', 'writer', 'auditor', 'analyst', 'investigator', 'illustrator', 'producer', 'messenger'];
const DEFAULT_PER_JOB: Partial<Record<Role, number>> = { researcher: 0.02, scout: 0.03, reader: 0.01, writer: 0.02, auditor: 0.01, analyst: 0.02, investigator: 0.4, illustrator: 0.4, producer: 1.2, messenger: MAIL?.sendUsd ?? 0 };

const BUCKETS = ['operating', 'tools', 'bond', 'reserve', 'promo'] as const;
type Bucket = (typeof BUCKETS)[number];
const B: Record<Bucket, number> = { operating: 0, tools: 1, bond: 2, reserve: 3, promo: 4 };

const VAULT = parseAbi([
  'function balances() view returns (uint256[5])',
  'function total() view returns (uint256)',
  'function bondsOutstanding() view returns (uint256)',
  'function reserveFloor() view returns (uint256)',
  'function maxMove() view returns (uint256)',
  'function epochToolBudget() view returns (uint256)',
  'function promoCapPerEpoch() view returns (uint256)',
  'function epoch() view returns (uint64)',
  'function epochAllocated() view returns (uint256)',
  'function owner() view returns (address)',
  'function agents(address) view returns (bool active, uint64 allowanceEpoch, uint128 allowance, uint128 toppedUp)',
  'function proposalCount() view returns (uint256)',
  'function proposals(uint256) view returns (uint8 kind, address who, uint8 from, uint8 to, uint256 amount, bytes32 reason, bool done)',
  'function sync() returns (uint256)',
  'function move(uint8 from, uint8 to, uint256 amount, bytes32 reason)',
  'function openEpoch(bytes32 allocationCommit)',
  'function closeEpoch(bytes32 recordHash)',
  'function setAllowance(address agent, uint128 amount)',
  'function topUp(address agent, uint256 amount, bytes32 reason)',
  'function propose(uint8 kind, address who, uint8 from, uint8 to, uint256 amount, bytes32 reason) returns (uint256)',
]);
const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)']);
const MOCK_GATEWAY = parseAbi(['function balanceFor(address) view returns (uint256)']);

const u6 = (x: bigint) => Number(x) / 1e6;
const atomic = (usd: number) => BigInt(Math.round(usd * 1e6));
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const usd = (x: number) => x.toFixed(x < 1 ? 4 : 2);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN; };

export type AgentView = { role: Role; address: Address; balance: number; perJob: number; perJobFrom: string; allowance: number; toppedUp: number; current: boolean; ready: number; readyFor: string };
/** Readiness: below `ready` (one job of the most expensive live service it works on) some service can't be taken. */
const lowOf = (a: AgentView) => Math.max(a.perJob * POLICY.lowWaterJobs, a.ready);
const targetOf = (a: AgentView) => Math.max(POLICY.minFloat, a.perJob * POLICY.jobsAhead, a.ready * 1.5);
const works = (a: AgentView) => Math.max(a.perJob, a.ready) > 0;
export type Snapshot = {
  at: string; mode: string;
  buckets: Record<Bucket, number>; vaultUsdc: number; unsynced: number;
  bondsOutstanding: number; reserveFloor: number; maxMove: number; epochToolBudget: number; epoch: number; epochAllocated: number;
  agents: AgentView[]; jobsPerWeek: number; cfoGas: number; owner: Address; promoCap: number;
  services: { id: string; name: string; ready: boolean; short: { role: Role; have: number; need: number }[] }[];
  teamGap: number; budgetWanted: number; // USDC the team is short of being ready for every service; the weekly budget that covers it
  pending: { id: number; from: Bucket; to: Bucket; amount: number; reason: Hex }[];
  proposals: { total: number; cosigned: number };
};
let last: Snapshot | null = null;
export const snapshot = () => last;
/** A fresh read of the vault for the public page (read-only; at most every two minutes). */
let refreshing: Promise<unknown> | null = null;
export async function freshSnapshot() {
  if (DEP && hasSeed() && !running && (!last || Date.now() - Date.parse(last.at) > 120_000)) {
    refreshing ??= observe().then((s) => { last = s; }).catch(() => {}).finally(() => { refreshing = null; });
    await refreshing;
  }
  return last;
}

// ---------------------------------------------------------------- what the CFO sees

/** Each paying agent's spend per job, from the receipts of the last 20 jobs it worked on. */
function spendHistory() {
  const per: Partial<Record<Role, number[]>> = {};
  const weekAgo = Date.now() - 7 * 86400_000;
  let jobsThisWeek = 0;
  for (const o of listOrders().filter((x) => x.demo === DRY && x.payment)) {
    if (Date.parse(o.payment!.at) > weekAgo) jobsThisWeek++;
    for (const r of o.runs) {
      const byAgent: Partial<Record<Role, number>> = {};
      for (const line of readJob(r)?.receipt ?? []) byAgent[line.agent as Role] = (byAgent[line.agent as Role] ?? 0) + line.usd;
      for (const [a, v] of Object.entries(byAgent)) if (v > 0) (per[a as Role] ??= []).push(v);
    }
  }
  return { per, jobsThisWeek };
}

async function agentBalance(role: Role): Promise<number> {
  if (DEP!.network === 'arc') return Number((await gateway(role).getBalances()).gateway.formattedAvailable);
  return u6(await pub.readContract({ address: DEP!.gatewayWallet, abi: MOCK_GATEWAY, functionName: 'balanceFor', args: [account(role).address] }));
}

async function observe(): Promise<Snapshot> {
  const v = DEP!.vault;
  const read = <T>(functionName: string, args: unknown[] = []) => pub.readContract({ address: v, abi: VAULT, functionName, args } as any) as Promise<T>;
  const [bal, total, bonds, floor, maxMove, budget, epoch, allocated, owner, count, usdcInVault, promoCap] = await Promise.all([
    read<readonly bigint[]>('balances'), read<bigint>('total'), read<bigint>('bondsOutstanding'), read<bigint>('reserveFloor'),
    read<bigint>('maxMove'), read<bigint>('epochToolBudget'), read<bigint>('epoch'), read<bigint>('epochAllocated'), read<Address>('owner'),
    read<bigint>('proposalCount'), pub.readContract({ address: DEP!.usdc, abi: ERC20, functionName: 'balanceOf', args: [v] }), read<bigint>('promoCapPerEpoch'),
  ]);
  const { need, by, perService } = readyNeeds();
  const { per, jobsThisWeek } = spendHistory();
  const agents: AgentView[] = [];
  const live = new Set(CATALOG.filter((c) => c.live).flatMap((c) => c.team));
  for (const role of PAYING.filter((r) => live.has(r))) {
    const address = account(role).address;
    const [a, balance] = await Promise.all([read<readonly [boolean, bigint, bigint, bigint]>('agents', [address]), agentBalance(role).catch(() => NaN)]);
    const hist = (per[role] ?? []).slice(-20);
    const perJob = hist.length ? median(hist) : DEFAULT_PER_JOB[role] ?? 0;
    const current = Number(a[1]) === Number(epoch);
    agents.push({ role, address, balance, perJob: r6(perJob), perJobFrom: hist.length ? `median of its last ${hist.length} jobs` : 'starting estimate', allowance: current ? u6(a[2]) : 0, toppedUp: current ? u6(a[3]) : 0, current, ready: r6(need[role] ?? 0), readyFor: by[role] ?? '' });
  }
  const bal1 = new Map(agents.map((x) => [x.role, x.balance]));
  const services = perService.map(({ id, name, spend }) => {
    const short = (Object.entries(spend) as [Role, number][]).filter(([r, n]) => n > 0.0005 && Number.isFinite(bal1.get(r) ?? NaN) && (bal1.get(r) ?? 0) < n).map(([role, n]) => ({ role, have: r6(bal1.get(role) ?? 0), need: r6(n) }));
    return { id, name, ready: !short.length, short };
  });
  // what it takes to have every agent at its readiness target, beyond the allowance it still has this week
  const teamGap = r6(agents.filter(works).reduce((t, x) => t + Math.max(0, targetOf(x) - (Number.isFinite(x.balance) ? x.balance : 0) - Math.max(0, x.allowance - x.toppedUp)), 0));
  const pending: Snapshot['pending'] = [];
  let cosigned = 0;
  for (let i = Math.max(0, Number(count) - 25); i < Number(count); i++) {
    const p = await read<readonly [number, Address, number, number, bigint, Hex, boolean]>('proposals', [BigInt(i)]);
    if (p[6]) cosigned++;
    else if (p[0] === 2) pending.push({ id: i, from: BUCKETS[p[2]], to: BUCKETS[p[3]], amount: u6(p[4]), reason: p[5] });
  }
  const buckets = Object.fromEntries(BUCKETS.map((b, i) => [b, u6(bal[i])])) as Record<Bucket, number>;
  return {
    at: new Date().toISOString(), mode: MODE, buckets, vaultUsdc: u6(usdcInVault as bigint), unsynced: r6(u6(usdcInVault as bigint) - u6(total)),
    bondsOutstanding: u6(bonds), reserveFloor: u6(floor), maxMove: u6(maxMove), epochToolBudget: u6(budget), epoch: Number(epoch), epochAllocated: u6(allocated),
    agents, jobsPerWeek: Math.max(POLICY.minJobsPerWeek, jobsThisWeek), cfoGas: Number(await pub.getBalance({ address: cfoAddress() })) / 1e18,
    promoCap: u6(promoCap as bigint), services, teamGap, budgetWanted: Math.ceil(u6(allocated) + teamGap),
    owner, pending, proposals: { total: Number(count), cosigned },
  };
}

// ---------------------------------------------------------------- acting, and writing it down

type Plan = { kind: DecisionKind; summary: string; rule: string; inputs: Record<string, unknown>; key: string; amount?: number; agent?: string; tx: () => Promise<{ hash: Hex }> };

/** The reason sealed into the vault transaction is the hash of the decision itself, committed before the money moves. */
const reasonOf = (p: Omit<Plan, 'tx'>): Hex => keccak256(toBytes(JSON.stringify({ kind: p.kind, rule: p.rule, amount: p.amount, agent: p.agent, inputs: p.inputs })));

/** Do it (live) or write down what would be done (observe). Returns whether the transaction went through. */
async function act(p: Plan, opts: { escalated?: boolean; proposal?: () => Promise<number> } = {}): Promise<boolean> {
  const stable = p.key.replace(/:\d{10,}$/, ''); // repeats of the same concern share a key
  if (MODE === 'observe') {
    if (!loggedWithin(`would:${stable}`, 6 * 3600_000)) {
      await record({ kind: p.kind, summary: p.summary, rule: p.rule, inputs: { ...p.inputs, reasonHash: reasonOf(p) }, key: `would:${stable}`, amount: p.amount, agent: p.agent, status: 'would-do' });
    }
    return false;
  }
  try {
    const { hash } = await p.tx();
    const proposal = opts.proposal ? await opts.proposal() : undefined;
    await record({ kind: p.kind, summary: p.summary, rule: p.rule, inputs: { ...p.inputs, reasonHash: reasonOf(p) }, key: p.key, amount: p.amount, agent: p.agent, tx: hash, proposal, status: opts.escalated ? 'escalated' : 'done' });
    return true;
  } catch (e: any) {
    if (!loggedWithin(`failed:${stable}`, 6 * 3600_000)) {
      await record({ kind: p.kind, summary: `${p.summary} It failed: ${String(e?.shortMessage ?? e?.message ?? e).slice(0, 140)}`, rule: p.rule, inputs: p.inputs, key: `failed:${stable}`, amount: p.amount, agent: p.agent, status: 'failed' });
    }
    return false;
  }
}

async function escalate(key: string, summary: string, rule: string, inputs: Record<string, unknown>) {
  if (loggedWithin(key, 24 * 3600_000)) return;
  await record({ kind: 'escalate', summary, rule, inputs, key, status: 'escalated' });
}

// ---------------------------------------------------------------- can the team afford this job?

const balances = new Map<Role, { usd: number; at: number }>();
async function cachedBalance(role: Role): Promise<number> {
  const hit = balances.get(role);
  if (hit && Date.now() - hit.at < 60_000) return hit.usd;
  const bal = await agentBalance(role).catch(() => NaN);
  balances.set(role, { usd: bal, at: Date.now() });
  return bal;
}



/** For each agent, one job of the most expensive live service it works on (and which), from each service's spend. */
function readyNeeds() {
  const need: Partial<Record<Role, number>> = {}, by: Partial<Record<Role, string>> = {};
  const perService = CATALOG.filter((c) => c.live).map((c) => ({ id: c.id, name: c.name, spend: spendFor(c.id) }));
  for (const { name, spend } of perService) for (const [r, v] of Object.entries(spend) as [Role, number][]) if ((v ?? 0) > (need[r] ?? 0)) { need[r] = v; by[r] = name; }
  return { need, by, perService };
}

/** Per-agent spend on this service's past live jobs (median of the last 10), or the demo measurement. */
function spendFor(service: string): Partial<Record<Role, number>> {
  const runs: Partial<Record<Role, number>>[] = [];
  for (const o of listOrders().filter((x) => x.service === service && x.demo === DRY && x.payment)) {
    for (const r of o.runs) {
      const j = readJob(r);
      if (j?.status !== 'delivered') continue;
      const by: Partial<Record<Role, number>> = {};
      for (const line of j.receipt ?? []) if (line.agent !== 'messenger') by[line.agent as Role] = (by[line.agent as Role] ?? 0) + line.usd;
      runs.push(by);
    }
  }
  if (!runs.length) return SPEND[service] ?? {};
  const last = runs.slice(-10), roles = new Set(last.flatMap((b) => Object.keys(b) as Role[]));
  return Object.fromEntries([...roles].map((r) => [r, median(last.map((b) => b[r] ?? 0))]));
}

/**
 * Before quoting, the CFO checks the team can pay for the job's tools: every agent that spends on this
 * service holds at least one job's worth in Gateway. An empty agent means a declined quote and a signed
 * request to the Boss, not a job that starts, fails at its first purchase and has to be refunded.
 * (The Designer and Producer pay for Opus 5 from their own wallets when they can, but fall back to
 * Gateway, so Gateway is what has to be covered.)
 */
export async function teamShortfall(service: string): Promise<string | undefined> {
  if (DRY || !DEP || !hasSeed()) return undefined;
  const item = CATALOG.find((c) => c.id === service);
  if (!item) return undefined;
  const need = Object.entries(spendFor(service)).filter(([, v]) => (v ?? 0) > 0.0005) as [Role, number][];
  const rows = await Promise.all(need.map(async ([role, perJob]) => ({ role, need: r6(perJob), have: await cachedBalance(role) })));
  const short = rows.filter((r) => Number.isFinite(r.have) && r.have < r.need);
  if (!short.length) return undefined;
  const who = short.map((r) => `${r.role} (${usd(r.have)} of ${usd(r.need)})`).join(', ');
  await escalate(`unfunded:${service}`, `Declined a ${item.name} quote: ${who} can't cover their part of a job. Asking the Boss to fund them.`,
    'never start a job the team can’t pay its tools for', { service, rows: rows.map((r) => ({ ...r, have: Number.isFinite(r.have) ? r6(r.have) : null })) });
  void tick(`a ${item.name} quote was declined: ${short.map((r) => r.role).join(', ')} short`); // re-plan and top up now, within the budget
  return `The ${item.name} team isn't funded for this job yet, so the CFO won't take it (it would fail halfway). It has asked the owner to fund them; please try again later.`;
}

const write = (fn: string, args: unknown[]) => () => cfoWrite(DEP!.vault, VAULT, fn, args);

// ---------------------------------------------------------------- one tick

let running = false;
export async function tick(reason = 'scheduled') {
  if (running || !DEP || !hasSeed()) return;
  running = true;
  try {
    let s = (last = await observe());
    const seen = { buckets: s.buckets, bondsOutstanding: s.bondsOutstanding, trigger: reason };

    // 0. Can the CFO still send transactions?
    if (s.cfoGas < POLICY.cfoGasMin) {
      await escalate('gas', `The CFO has ${usd(s.cfoGas)} USDC for gas, below ${POLICY.cfoGasMin}. It can't open escrows or move money until the Boss sends it some.`, 'keep enough gas to act', { cfoGas: s.cfoGas });
      return;
    }

    // 1. Money that arrived in the vault directly (the Boss funding it) is credited to OPERATING.
    if (s.unsynced >= POLICY.dust) {
      await act({ kind: 'move', summary: `${usd(s.unsynced)} USDC arrived in the vault; credited it to OPERATING.`, rule: 'credit new money to OPERATING', inputs: { vaultUsdc: s.vaultUsdc, booked: r6(s.vaultUsdc - s.unsynced) }, key: `sync:${s.vaultUsdc}`, amount: s.unsynced, tx: write('sync', []) });
      if (MODE === 'live') s = last = await observe();
    }

    // 2. A new week: plan each agent's allowance from its measured spend, seal the plan's hash on-chain first.
    const planFile = join(DATA_DIR, 'cfo', 'epoch.json');
    const plan = existsSync(planFile) ? JSON.parse(readFileSync(planFile, 'utf8')) : null;
    const stale = !plan || plan.vaultEpoch !== s.epoch || Date.now() - Date.parse(plan.openedAt) > POLICY.epochDays * 86400_000;
    if (stale) {
      // Readiness first (every agent able to do one and a half jobs of the priciest service it works on, so no
      // service is turned away), then the week's expected spend in whatever budget is left.
      const workers = s.agents.filter(works);
      const ready = Object.fromEntries(workers.map((a) => [a.role, r6(Math.max(0, targetOf(a) - (Number.isFinite(a.balance) ? a.balance : 0)))]));
      const spend = Object.fromEntries(workers.map((a) => [a.role, r6(a.perJob * s.jobsPerWeek)]));
      const sumReady = Object.values(ready).reduce((t, x) => t + x, 0), sumSpend = Object.values(spend).reduce((t, x) => t + x, 0);
      const readyScale = sumReady > s.epochToolBudget ? s.epochToolBudget / sumReady : 1;
      const spendScale = sumSpend > 0 ? Math.max(0, Math.min(1, (s.epochToolBudget - sumReady * readyScale) / sumSpend)) : 0;
      const want = Object.fromEntries(workers.map((a) => [a.role, ready[a.role] + spend[a.role]]));
      const scale = readyScale < 1 ? readyScale : spendScale;
      if (readyScale < 1) await escalate(`budget-short:w${s.epoch + 1}`, `Getting every agent ready for any service this week takes ${usd(sumReady)} USDC of tools, but the vault's weekly tool budget is ${usd(s.epochToolBudget)}. Raise it to at least ${Math.ceil(sumReady + 0.5)} on the Books page so no service is turned away.`, "plan inside the Boss's weekly budget", { ready, spend, budget: s.epochToolBudget });
      let allowances = Object.fromEntries(workers.map((a) => [a.role, Math.max(POLICY.minFloat, Math.floor((ready[a.role] * readyScale + spend[a.role] * spendScale) * 1e4) / 1e4)]));
      const total = Object.values(allowances).reduce((t, x) => t + x, 0); // the floors can tip it over: the vault would refuse the last one
      if (total > s.epochToolBudget) allowances = Object.fromEntries(Object.entries(allowances).map(([r, x]) => [r, Math.floor((x * s.epochToolBudget) / total * 1e4) / 1e4]));
      const next = { vaultEpoch: s.epoch + 1, openedAt: new Date().toISOString(), jobsPerWeek: s.jobsPerWeek, allowances, perJob: Object.fromEntries(s.agents.map((a) => [a.role, a.perJob])), scale: r6(scale), budget: s.epochToolBudget };
      const commit = keccak256(toBytes(JSON.stringify(next)));
      const lines = Object.entries(allowances).map(([r, x]) => `${r} ${usd(x)}`).join(', ');
      const planned = { kind: 'epoch' as const, summary: `Planned week ${next.vaultEpoch}: every agent ready for any service${readyScale < 1 ? ' (as far as the budget goes)' : ''}, then ${s.jobsPerWeek} jobs of usual work${readyScale >= 1 && spendScale < 1 ? ' scaled to fit' : ''}, so allowances ${lines} inside the ${s.epochToolBudget} USDC weekly budget. The plan's hash is sealed on-chain before any money moves.`, rule: 'plan allowances weekly from measured spend per job', inputs: { plan: next, commit }, key: `epoch:${next.vaultEpoch}` };
      if (MODE === 'observe') await act({ ...planned, tx: async () => ({ hash: '0x' as Hex }) });
      else {
        const closing = plan ? keccak256(toBytes(JSON.stringify(decisions(500).filter((d) => Date.parse(d.at) >= Date.parse(plan.openedAt)).map((d) => d.hash)))) : null;
        if (closing) await cfoWrite(DEP.vault, VAULT, 'closeEpoch', [closing]).catch(() => {});
        if (!(await act({ ...planned, tx: write('openEpoch', [commit]) }))) return;
        mkdirSync(join(DATA_DIR, 'cfo'), { recursive: true });
        writeFileSync(planFile, JSON.stringify({ ...next, commit }, null, 2));
        for (const [role, x] of Object.entries(allowances)) {
          await cfoWrite(DEP.vault, VAULT, 'setAllowance', [account(role as Role).address, atomic(x)]).catch((e) =>
            record({ kind: 'allowance', summary: `Setting ${role}'s allowance to ${usd(x)} USDC failed: ${String(e?.shortMessage ?? e?.message).slice(0, 120)}`, rule: 'plan allowances weekly from measured spend per job', inputs: { role, allowance: x }, key: `allowance-failed:${role}:w${next.vaultEpoch}`, agent: role, status: 'failed' }));
        }
        s = last = await observe();
      }
    }

    // 2b. Mid-week: an agent that has spent its whole allowance and is running low gets more: first from the
    //     room left in the week's tool budget, then from allowance that fully stocked agents aren't using.
    //     The vault enforces the budget (setAllowance reverts past it, and can't go below what an agent was
    //     already sent), so re-planning never spends more in a week than the Boss allowed; it only stops a
    //     plan made from last week's guess starving a busy agent while an idle one sits on its allowance.
    let room = r6(s.epochToolBudget - s.epochAllocated);
    const funded = r6(s.buckets.tools + s.buckets.operating);
    const plan2 = new Map(s.agents.map((a) => [a.role, a.allowance]));
    let replanned = false;
    for (const a of s.agents) {
      if (!works(a) || !Number.isFinite(a.balance) || funded < POLICY.dust) continue;
      const low = lowOf(a), target = targetOf(a);
      const mine = plan2.get(a.role)!;
      if (a.balance >= low || r6(mine - a.toppedUp) >= POLICY.dust) continue;
      const want = r6(target - a.balance);
      // agents stocked to their target don't need their unused allowance this week
      const donors = s.agents.filter((d) => d.role !== a.role && Number.isFinite(d.balance) && d.balance >= targetOf(d))
        .map((d) => ({ d, spare: r6(plan2.get(d.role)! - d.toppedUp) })).filter((x) => x.spare >= POLICY.dust).sort((x, y) => y.spare - x.spare);
      const cuts: { role: Role; address: Address; from: number; to: number }[] = [];
      let found = Math.min(room, want);
      for (const { d, spare } of donors) {
        if (found >= want - 1e-9) break;
        const cut = r6(Math.min(spare, want - found));
        cuts.push({ role: d.role, address: d.address, from: plan2.get(d.role)!, to: r6(plan2.get(d.role)! - cut) });
        found = r6(found + cut);
      }
      const raise = r6(found);
      if (raise < POLICY.dust) continue; // nothing to give this week: step 4 tells the Boss
      const to = r6(mine + raise), fromRoom = r6(Math.min(room, want));
      const inputs = { ...seen, role: a.role, balance: a.balance, perJob: a.perJob, perJobFrom: a.perJobFrom, allowance: mine, toppedUp: a.toppedUp, epochToolBudget: s.epochToolBudget, epochAllocated: s.epochAllocated, room, fromRoom, cuts, fundedUsd: funded };
      const moved = cuts.map((c) => `${usd(r6(c.from - c.to))} of ${c.role}'s unused allowance`).join(' and ');
      const why = cuts.length ? `; ${cuts.map((c) => c.role).join(' and ')} ${cuts.length === 1 ? 'is' : 'are'} stocked and won't need it this week` : '';
      const ok = await act({
        kind: 'allowance', agent: a.role, amount: raise, inputs, rule: "re-plan mid-week inside the vault's weekly tool budget", key: `replan:${a.role}:w${s.epoch}:${Date.now()}`,
        summary: `Re-planned mid-week: ${a.role} ${mine > 0 ? `used all ${usd(mine)} USDC of its allowance` : 'had no allowance this week'} and has ${usd(a.balance)} left, ${a.ready > a.perJob * POLICY.lowWaterJobs ? `less than one ${a.readyFor} job needs (${usd(a.ready)})` : "under two jobs' worth"}. Gave it ${usd(raise)} more, to ${usd(to)}: ${[fromRoom >= POLICY.dust ? `${usd(fromRoom)} from the budget's unplanned room` : '', moved].filter(Boolean).join(' and ')}${why}. The week stays inside its ${usd(s.epochToolBudget)} USDC budget; the vault refuses anything past it.`,
        tx: async () => {
          for (const c of cuts) await cfoWrite(DEP!.vault, VAULT, 'setAllowance', [c.address, atomic(c.to)]); // free the room first
          return cfoWrite(DEP!.vault, VAULT, 'setAllowance', [a.address, atomic(to)]);
        },
      });
      if (ok) { for (const c of cuts) plan2.set(c.role, c.to); plan2.set(a.role, to); room = r6(room - fromRoom); replanned = true; }
    }
    if (replanned) s = last = await observe();

    // 3. Put revenue to work, in order: TOOLS for this week's remaining allowances, BOND to its target,
    //    RESERVE to its floor. The rest stays in OPERATING. Alone, the CFO moves at most maxMove per
    //    bucket pair per week; it moves what that allows and asks the Boss to co-sign the rest.
    const toolsNeed = r6(s.agents.reduce((t, a) => t + Math.max(0, a.allowance - a.toppedUp), 0) - s.buckets.tools);
    const wants: [Bucket, number, string][] = [
      ['tools', toolsNeed, `cover the ${usd(toolsNeed + s.buckets.tools)} USDC agents may still draw this week`],
      ['bond', r6(POLICY.bondTarget - s.buckets.bond), `hold ${POLICY.bondTarget} USDC of bond cover, enough for two top-size guarantees`],
      ['reserve', r6(s.reserveFloor - s.buckets.reserve), `keep the reserve at its ${s.reserveFloor} USDC floor`],
    ];
    let operating = s.buckets.operating;
    for (const [to, gap, why] of wants) {
      const amount = r6(Math.min(gap, operating));
      if (amount < POLICY.dust) continue;
      const movedThisWeek = decisions(500).filter((d) => d.kind === 'move' && d.status === 'done' && d.key?.startsWith(`move:operating>${to}:w${s.epoch}`)).reduce((t, d) => t + (d.amount ?? 0), 0);
      const base = { summary: '', rule: 'revenue goes to TOOLS, then BOND, then RESERVE', inputs: { ...seen, gap, movedThisWeek, maxMove: s.maxMove }, amount };
      const alone = r6(Math.min(amount, Math.max(0, s.maxMove - movedThisWeek))), rest = r6(amount - alone);
      if (alone >= POLICY.dust) {
        await act({ ...base, amount: alone, kind: 'move', summary: `Moved ${usd(alone)} USDC from OPERATING to ${to.toUpperCase()} to ${why}${rest >= POLICY.dust ? ` (all it moves alone this week; it asks the Boss for the other ${usd(rest)})` : ''}.`, key: `move:operating>${to}:w${s.epoch}:${Date.now()}`, tx: write('move', [B.operating, B[to], atomic(alone), reasonOf({ ...base, kind: 'move', key: '' })]) });
      }
      if (rest >= POLICY.dust && !s.pending.some((p) => p.from === 'operating' && p.to === to)) {
        const id = s.proposals.total;
        await act({ ...base, amount: rest, kind: 'propose', summary: `Asked the Boss to co-sign moving ${usd(rest)} USDC from OPERATING to ${to.toUpperCase()} to ${why}: past the ${s.maxMove} USDC a week the CFO moves alone.`, key: `propose:operating>${to}:w${s.epoch}:${Date.now()}`, tx: write('propose', [2, '0x0000000000000000000000000000000000000000', B.operating, B[to], atomic(rest), reasonOf({ ...base, kind: 'propose', key: '' })]) }, { escalated: true, proposal: async () => id });
      }
      operating = r6(operating - amount);
    }
    if (MODE === 'live') s = last = await observe();

    // 4. Top up any agent that can afford fewer than two of its jobs, from TOOLS, within its allowance.
    let tools = s.buckets.tools;
    const starved: string[] = [];
    for (const a of s.agents) {
      if (!works(a) || !Number.isFinite(a.balance)) continue;
      const low = lowOf(a), target = targetOf(a);
      if (a.balance >= low) continue;
      const want = r6(target - a.balance), left = r6(a.allowance - a.toppedUp);
      const amount = r6(Math.min(want, left, tools));
      const inputs = { balance: a.balance, perJob: a.perJob, perJobFrom: a.perJobFrom, ready: a.ready, readyFor: a.readyFor, lowWater: r6(low), target: r6(target), allowanceLeft: left, tools };
      if (amount >= POLICY.dust) {
        const after = a.balance + amount, jobs = a.perJob > 0 ? Math.floor(after / a.perJob + 1e-9) : 0;
        const capped = amount < want - 1e-9 ? (amount === left ? ', as far as its weekly allowance goes' : ', all that TOOLS holds') : '';
        const why = a.ready > a.perJob * POLICY.lowWaterJobs ? `less than one ${a.readyFor} job needs (${usd(a.ready)})` : `under two jobs' worth (${usd(low)})`;
        const now = after >= a.ready ? `ready for any job it works on${jobs > 1 ? `, about ${jobs} of its usual jobs` : ''}` : jobs < 1 ? "less than one job's worth" : `about ${jobs} job${jobs === 1 ? "'s" : "s'"} worth`;
        await act({ kind: 'top-up', summary: `${a.role} had ${usd(a.balance)} USDC, ${why}. Topped it up by ${usd(amount)} to ${usd(after)}, ${now}${capped}.`, rule: 'keep every agent funded for its next jobs', inputs, key: `topup:${a.role}:${Date.now()}`, amount, agent: a.role, tx: write('topUp', [a.address, atomic(amount), reasonOf({ kind: 'top-up', summary: '', rule: 'keep every agent funded for its next jobs', inputs, key: '', amount, agent: a.role })]) });
        tools = r6(tools - amount);
      } else if (left < POLICY.dust) {
        await escalate(`allowance:${a.role}:w${s.epoch}`, `${a.role} is low (${usd(a.balance)} USDC${a.ready > a.balance ? `; a ${a.readyFor} job needs ${usd(a.ready)}` : ''}) and has used its whole allowance for this week. Raise the weekly tool budget on the Books page (to about ${s.budgetWanted} USDC) and the CFO funds it within minutes.`, 'never top up past the weekly allowance', inputs);
      } else starved.push(`${a.role} (${usd(a.balance)})`);
    }
    if (starved.length) {
      await escalate(`tools-empty:${starved.length}`, `${starved.join(', ')} ${starved.length === 1 ? 'is' : 'are'} low, but the TOOLS bucket is empty and there is no revenue to move into it. The Boss needs to add USDC to the vault.`, 'top-ups come only from TOOLS', { starved, tools, operating: s.buckets.operating });
    }
    last = MODE === 'live' ? await observe() : s;
  } catch (e: any) {
    if (!loggedWithin('tick-error', 6 * 3600_000)) await record({ kind: 'hold', summary: `The CFO couldn't finish a check: ${String(e?.shortMessage ?? e?.message ?? e).slice(0, 160)}`, rule: 'retry next tick', inputs: {}, key: 'tick-error', status: 'failed' });
  } finally {
    running = false;
  }
}

/** Tick every few minutes, and soon after money comes in or a job finishes. */
export function startTreasury() {
  const dep = DEP;
  if (!dep) return;
  setTimeout(() => void tick('startup'), 5000);
  setInterval(() => void tick(), POLICY.tickMinutes * 60_000);
  // Money landing in the vault (the Boss funding the team, revenue released by escrow) is acted on within a minute.
  setInterval(async () => {
    if (running || !last) return;
    const held = u6(await pub.readContract({ address: dep.usdc, abi: ERC20, functionName: 'balanceOf', args: [dep.vault] }).catch(() => atomic(last!.vaultUsdc)));
    if (held - last.vaultUsdc >= POLICY.dust) void tick(`${usd(r6(held - last.vaultUsdc))} USDC arrived in the vault`);
  }, 60_000);
  let soon: NodeJS.Timeout | undefined;
  bus.on('event', (e: any) => {
    if (e.type !== 'order' || !['accepted', 'delivered', 'failed', 'rejected'].includes(e.data?.status)) return;
    clearTimeout(soon);
    soon = setTimeout(() => void tick(`order ${e.data.status}`), 30_000);
  });
}
