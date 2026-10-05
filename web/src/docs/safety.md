---
title: Safety controls
description: The ways software that moves money usually fails, and what Syncly does about each one.
group: Money and trust
order: 2
---

Canteen's essay [*Agents and Ledgers in 2026*](https://thecanteenapp.com/analysis/2026/09/12/agents-and-ledgers.html) lists the mistakes an AI can make with money that still leave the books balanced. This page goes through them one by one.

## Who we pay

**The risk:** paying the wrong party. Reconciling against the chain can't catch it, because the chain confirms you paid exactly whom you chose.

**What we do:**

- Each seller's payout address is **pinned per service** in [`payees.json`](https://github.com/neromtoobad/syncly/blob/main/server/src/payees.json), which is reviewed in git. A new service is pinned on its first payment.
- If a seller asks to be paid at a different address, the payment is **refused before anything is signed** and the refusal goes into the CFO's log for review.
- Every payee, and every customer wallet before an escrow opens, is **screened against Circle's USDC blacklist**. Every address we or a Pay business deal with is **re-screened daily**, and **one hop out**: the other side of every USDC transfer they make or receive on Arc is screened too.
- An escrow's customer is fixed when it opens, and only that wallet can receive a refund or a bond.

## Paying twice

**The risk:** a call times out, the software retries, and the seller is paid twice.

**What we do:** an agent's payment has two phases, a free request that returns the price and then the signed payment. A timeout before signing is retried. A timeout **after** signing is ambiguous (the seller may already have the money), so it is **not retried**. The agent retries only when the seller says it didn't take the payment. A [test against a fake seller](https://github.com/neromtoobad/syncly/blob/main/server/scripts/pay-safety.ts) checks each case.

## Payments that never happened

**The risk:** the books record a payment that never went out.

**What we do:** a receipt line is written only after a paid call succeeds. Each is then linked to the settlement transaction Circle Gateway produced on Arc, a record from outside our own books.

## Rounding

**The risk:** reading `6.000000` as `6.00` and hiding the difference in a "round-off" account.

**What we do:** the ledger keeps USDC's six decimals and refuses an unbalanced entry. There is no silent round-off account.

## Letting a model release money

**The risk:** an escrow that pays out because an AI said "HIGH confidence".

**What we do:** only the customer's wallet releases a payment. The CFO's rules are deterministic, and AI models only produce the work and check it. The Auditor can flag work but can't approve a payment.

## An entry with no document

**The risk:** a ledger line nobody can trace to a real order.

**What we do:** every ledger line points to its job. Every escrow seals the terms (`specHash`) and the delivery (`deliverableHash`) on-chain, so terms, delivery and payment can be matched.

## A business's own payments (Syncly Pay)

[Syncly Pay](/docs/pay) moves a customer business's money, not ours, so it has its own controls, most of them in the [InvoiceBook](https://github.com/neromtoobad/syncly/blob/main/contracts/src/InvoiceBook.sol) contract:

| Risk | Control |
|---|---|
| A pay link edited to send the money elsewhere | The payee is fixed on-chain when the invoice is booked; `pay` only transfers to it. |
| An invoice paid twice | `pay` works once per invoice; a second call reverts. The Investigator also stops a bill that matches one already booked (same document, or same supplier and invoice number) before it is booked at all. |
| A supplier's "new bank details" scam | Each supplier's payout address is pinned after the first payment. A bill with a different address is stopped until the owner says they called the supplier on a number they already had. |
| An invoice with no real document | Each invoice's document hash is fixed before any money moves; the pay page shows the document and its hash. |
| Someone invoicing in a business's name | Only the CFO's key can book, and only after the business confirms its email. A new payout address for an existing business waits for the same confirmation. |
| A sanctioned address | Every payee is screened against Circle's USDC blacklist when it's checked, again every day, and one hop out (whoever it trades with on Arc). A hit stops payments to it. |
| An agent paying bills on its own | Autopay runs from the business's own PayVault account: the contract lets the CFO pay only suppliers the owner approved, under the owner's per-bill and weekly caps, and only booked invoices. Anything else is a proposal the owner approves from their wallet. The desk offers a supplier for autopay only after the owner has paid it once. |
| Rounding | Exact USDC to 6 decimals; the 0.5% fee is floored, in the payee's favour. |

## Limits the agents can't talk past

| Limit | Enforced by |
|---|---|
| Sellers allowed per service | The payment code, before signing |
| Budget per job, price cap per call | The payment code, before signing |
| CFO moves at most `maxMove` alone (7 USDC today, set by the Boss) | The SynclyVault contract (`maxMove`) |
| Weekly tool budget, reserve floor, bond cover | The SynclyVault contract |
| Only the customer accepts or rejects | The JobEscrow contract |
| Autopay only to approved suppliers, under per-bill and weekly caps | The PayVault contract |
| Only a business's owner withdraws its autopay money or changes its rules | The PayVault contract |
| A mid-week re-plan stays inside the weekly tool budget | The SynclyVault contract (`setAllowance`) |

> **Honest limit** The payment code's checks run on our server. The contract limits apply to the vault and the escrow, not to what an agent may spend from its own Gateway balance once topped up. That is why top-ups are small and weekly.
