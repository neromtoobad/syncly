---
title: The CFO
description: How the AI CFO prices jobs, runs the treasury, and what it is not allowed to do.
group: The company
order: 2
---

The CFO is the agent that runs Syncly's money. It prices every job and manages the vault. It never grades the team's work; the customer does. **No language model touches money.** Every number the CFO produces is computed by fixed rules, and every reason is written down.

## How it prices a job

Each quote is worked out step by step, and the steps are printed on it:

| Step | Rule |
|---|---|
| **Tool cost** | The median measured cost of past jobs of this service, but never below half the listed estimate. New services use the listed estimate. |
| **p(accept)** | The chance you'll accept: a Beta(4, 1) prior updated with this service's real accepts and rejects. |
| **Bond** | 10% of the price when p(accept) ≤ 0.70, rising to 30% at p(accept) ≥ 0.95. It is capped by how much the vault's BOND bucket can still cover. |
| **Expected profit** | p · price − cost − (1 − p) · bond. Prices are kept at 1 or 2 USDC on purpose, so some jobs run at a loss; the CFO declines a job only if it would lose more than 2 USDC. |
| **Free first website** (off) | During launch week, a first Website was free when the week's promo budget (2 USDC) and a 1.50 USDC cost cap allowed it. It's switched off now (`FREE_FIRST_WEBSITE=1` turns it back on); the rule stays in the CFO for when it is. |

The more jobs customers accept, the higher p(accept) climbs and the bigger the bond the CFO puts up: it bets more on work it has earned confidence in.

## The treasury loop

Every 10 minutes, and 30 seconds after any job is accepted, delivered, failed or rejected, the CFO:

1. **Reads** the vault's five buckets, each agent's Gateway balance, and the past week's spend per agent per job.
2. **Plans the week.** Each agent's allowance is its measured spend per job times the jobs expected (at least 5 a week), scaled to fit the vault's weekly tool budget. **The plan's hash is sealed on-chain (`openEpoch`) before any money moves.**
3. **Puts revenue to work**, in order: TOOLS for the week's remaining allowances, then BOND up to 3 USDC of cover, then RESERVE up to its floor. The rest stays in OPERATING.
4. **Tops up** any agent that can afford fewer than 2 of its jobs, to about 5 jobs' worth, within its allowance.
5. **Re-plans mid-week** when an agent has used its whole allowance and is running low: it gives that agent more, first from the week's unplanned budget, then from allowance that fully stocked agents won't need. `setAllowance` still enforces the weekly tool budget on-chain, so a re-plan can never spend more in a week than the Boss allowed.
6. **Escalates** to the Boss when it can't act: the TOOLS bucket is empty, it is low on gas, or the week's whole budget is used.

New money in the vault is acted on within a minute: a watcher reads the vault's USDC balance every minute and runs the loop when it grows.

## Funding the team

The Boss doesn't split money between agents by hand. They send USDC to the vault (the owner's desk has a **Fund the team** box, or any wallet can send USDC on Arc to the vault's address), and the CFO does the rest: credits it to OPERATING, moves what the week's allowances need into TOOLS, and tops each agent up from its plan, all inside the limits below.

## What it can't do

These limits are enforced by the [SynclyVault](/docs/on-chain) contract, not by a prompt:

- **It can't send money out.** The CFO key can move money between the vault's buckets, top up registered agents' Gateway balances within their allowance, and pay approved human reviewers. No function lets it send vault money anywhere else.
- **It moves at most 2 USDC in one step** (`maxMove`). Anything bigger must be a `propose`, and only the Boss's wallet can `coSign` it. The CFO's own policy also limits it to 2 USDC per bucket pair per week, and it never splits a move to get under the limit.
- **Allowances can't exceed the weekly tool budget** of 3 USDC across all agents.
- **The reserve can't drop below its floor** (1 USDC), and **bonds must always be covered** by the BOND bucket.

The Boss is a human's wallet, outside the server's keys. It owns the vault and can change the policy.

## The decision log

Every decision goes into an append-only log:

- **What the CFO saw:** the balances and inputs at the time.
- **The rule that fired**, the amount, and the transaction.
- **A hash of the entry**, chained to the one before it.
- **A signature** from the CFO's key.

The vault transaction's `reason` field carries the hash of the decision behind it. The log is public at [/api/cfo](/api/cfo). [Verify it yourself](/docs/verify#the-cfos-decision-log).

## Syncly Pay

The CFO's key is the only one InvoiceBook accepts as a booker. It books a business's invoice or bill only after the business has confirmed its email and, for a bill, after the Investigator's checks were cleared by the owner. It pays a bill itself only through [autopay](/docs/pay#autopay-inside-limits-you-set), from the business's own PayVault account, to a supplier the owner approved, under the owner's caps; the PayVault contract enforces each of those. Outside them it can only propose, and the owner decides from their wallet. It also re-screens every address Pay businesses deal with each day, and emails each business a report every Monday. The 0.5% fee from each paid invoice goes straight to SynclyVault, where the CFO's next tick credits it to OPERATING with the rest of Syncly's revenue.

## Proposals and the Boss

When the CFO needs more than it may do alone, it writes an on-chain **proposal**, for example "move 4.05 USDC from OPERATING to RESERVE". The proposal appears on the owner's private desk under **Waiting on the Boss**, with a co-sign button that only the vault owner's wallet can use. The desk counts how many proposals were made and how many the Boss agreed to.
