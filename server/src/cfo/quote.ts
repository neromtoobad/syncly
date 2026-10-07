// The CFO's quote: a deterministic, explainable decision (the LLM never sets money terms).
//   cost      = median measured tool spend for this service (falls back to the listed estimate)
//   p(accept) = Beta posterior on this service's acceptance history (prior Beta(4,1))
//   bond      = 10–30% of price, rising with confidence: the CFO bets more when it has earned it,
//               capped by what the BOND bucket can still cover
//   E[profit] = p·price − cost − (1−p)·bond ; decline if below the floor
// Every number and reason is returned so it can be sealed into the decision record.

export type History = { costs: number[]; accepted: number; rejected: number };
export type QuoteInput = {
  service: string;
  priceUsd: number;
  listedCostUsd: number;
  history: History;
  bondPoolFreeUsd: number; // BOND bucket − bonds already outstanding
  firstJobForCustomer: boolean;
  promoLeftUsd: number;
  deliverHours: number;
};
export type Quote = {
  service: string;
  priceUsd: number; // what the customer pays (0 if promo)
  promo: boolean;
  bondUsd: number;
  bondBps: number;
  estCostUsd: number;
  pAccept: number;
  expectedProfitUsd: number;
  decision: 'quote' | 'decline';
  deliverHours: number;
  reasons: string[];
};

// Prices are kept at 1 or 2 USDC on purpose (the owner's call, 2026-10-03: traction over profit), so some jobs cost
// more in tools than they earn: the CFO takes a job unless it is expected to lose more than 2 USDC.
export const POLICY = { priorA: 4, priorB: 1, minBps: 1000, maxBps: 3000, minExpectedProfit: -3.5, promoMaxCost: 1.5 };

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

export function quote(q: QuoteInput): Quote {
  const reasons: string[] = [];
  const measured = median(q.history.costs);
  const estCost = Number.isFinite(measured) ? Math.max(measured, q.listedCostUsd * 0.5) : q.listedCostUsd;
  reasons.push(!Number.isFinite(measured)
    ? `tool cost ${r4(estCost)} USDC = listed estimate (no ${q.service} jobs yet)`
    : estCost > measured
      ? `tool cost ${r4(estCost)} USDC = floor of half the listed estimate (median of ${q.history.costs.length} past jobs was only ${r4(measured)})`
      : `tool cost ${r4(estCost)} USDC = median of ${q.history.costs.length} past ${q.service} jobs`);

  const n = q.history.accepted + q.history.rejected;
  const pAccept = (POLICY.priorA + q.history.accepted) / (POLICY.priorA + POLICY.priorB + n);
  reasons.push(`p(accept) ${pAccept.toFixed(2)} from ${q.history.accepted}/${n} accepted + prior Beta(${POLICY.priorA},${POLICY.priorB})`);

  // Free first job: no escrow, no bond, paid from PROMO if the cost fits.
  if (q.firstJobForCustomer && q.promoLeftUsd >= estCost && estCost <= POLICY.promoMaxCost) {
    reasons.push(`first job free: promo covers ${r4(estCost)} (promo left ${r2(q.promoLeftUsd)})`);
    return { service: q.service, priceUsd: 0, promo: true, bondUsd: 0, bondBps: 0, estCostUsd: r4(estCost), pAccept, expectedProfitUsd: r4(-estCost), decision: 'quote', deliverHours: q.deliverHours, reasons };
  }
  if (q.firstJobForCustomer) reasons.push('first job not free: promo budget or cost cap exceeded');

  // Bond grows with confidence: 10% at p≤0.7, 30% at p≥0.95
  const t = Math.min(1, Math.max(0, (pAccept - 0.7) / 0.25));
  let bps = Math.round(POLICY.minBps + t * (POLICY.maxBps - POLICY.minBps));
  let bond = r2((q.priceUsd * bps) / 10_000);
  if (bond > q.bondPoolFreeUsd) {
    reasons.push(`bond cut from ${bond} to ${r2(q.bondPoolFreeUsd)}: BOND bucket can't cover more`);
    bond = Math.max(0, r2(q.bondPoolFreeUsd));
    bps = Math.round((bond / q.priceUsd) * 10_000);
  }
  reasons.push(`bond ${bond} USDC (${(bps / 100).toFixed(0)}% of price) because confidence is ${pAccept.toFixed(2)}`);

  const expectedProfit = pAccept * q.priceUsd - estCost - (1 - pAccept) * bond;
  const decision = expectedProfit >= POLICY.minExpectedProfit ? 'quote' : 'decline';
  reasons.push(`E[profit] = ${pAccept.toFixed(2)}×${q.priceUsd} − ${r4(estCost)} − ${(1 - pAccept).toFixed(2)}×${bond} = ${r4(expectedProfit)} → ${decision === 'quote' ? (expectedProfit < 0 ? 'quote it at a loss (the price is kept low on purpose)' : 'quote it') : `decline (it would lose more than ${-POLICY.minExpectedProfit} USDC)`}`);

  return { service: q.service, priceUsd: q.priceUsd, promo: false, bondUsd: bond, bondBps: bps, estCostUsd: r4(estCost), pAccept, expectedProfitUsd: r4(expectedProfit), decision, deliverHours: q.deliverHours, reasons };
}
