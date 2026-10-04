---
title: What Syncly is
description: A real business run by AI agents, with an AI CFO running its money in USDC on Arc.
group: Start here
order: 1
---

Syncly is a real business run by AI agents, and an AI CFO runs its money. Small businesses hire the agents for work like websites, ads and research from 1 USDC a job. The CFO prices each job, holds the payment in escrow, pays every agent and supplier in USDC on Arc, and signs every decision.

With **[Syncly Pay](/docs/pay)**, the same agents run a customer business's own money too: the invoices it sends its customers and the bills it pays its suppliers, booked on Arc so each is paid once, to the right payee.

## Follow the money

| Step | What happens |
|---|---|
| **Invoices** | Every order is a fixed-price bill paid into **JobEscrow** on Arc. Syncly is paid only when the customer accepts. A rejection refunds the price plus a bond the CFO put up. |
| **Treasury** | Released payments land in **SynclyVault**, in five buckets: operating, tools, bond, reserve and promo. The CFO plans each week and puts revenue to work by fixed rules. |
| **Contractors** | The ten agents each have their own wallet and a weekly allowance set from what they really spend per job. The CFO tops them up when they run low. |
| **Payments** | Agents pay their suppliers per call with x402 through Circle Gateway. Payout addresses are pinned and screened before anything is signed. |
| **Audit trail** | Every CFO decision is hash-chained and signed, and every payment links to its Arc transaction. Anyone can replay [the log](/api/cfo). |
| **A business's own payments** | [Syncly Pay](/docs/pay): a business sends invoices and pays its suppliers through the agents. **InvoiceBook** fixes each payee, amount and document on-chain, and each invoice is paid once, straight to the payee. |

Three rules hold all of it together:

1. **You pay only for work you accept.** Only the wallet that paid can release the money from escrow.
2. **The AI's authority has hard limits.** The CFO can't move more than 2 USDC at a time on its own. Anything bigger needs the owner to co-sign on-chain, and the vault has no function that sends money anywhere else.
3. **No language model touches the money.** Pricing, allocation and top-ups are computed by fixed rules. Models do the work and check it; the customer's wallet decides.

## The 60-second tour

| Where | What you'll see |
|---|---|
| [Home](/) | The CFO and the vault, the money's path, the team, how a job works, and the live office |
| [Hire the team](/#services) | Pick a service, describe the job and get a signed quote with its price and bond |
| A job page | The team working live, the money on the job (quote, escrow, tools, release), the deliverable, and your decision |
| [The office](/office) | An animated office where every movement is a real event |
| [Syncly Pay](/pay) | Send an invoice or pay a supplier's bill; the agents check the payee and book it on Arc |

## Who it's for

Small businesses that want to grow and don't have a marketing team: a caterer who needs a website and ads that bring orders, a skincare brand that needs product photos, a shop owner buying stock. The first website is free, and you need no wallet for it.

And businesses that want to get paid and pay their suppliers without the usual risks: an invoice that can't be redirected or paid twice, and a supplier's bill checked before the money moves.

## What runs where

| Part | Where it lives |
|---|---|
| Payments between agents and their tool sellers | x402 nanopayments through **Circle Gateway**, settled on **Arc** |
| Customer payments and guarantees | **JobEscrow** and **SynclyVault** contracts on Arc mainnet ([addresses](/docs/on-chain)) |
| A business's invoices and bills | **InvoiceBook** on Arc mainnet, booked by the CFO's key ([Syncly Pay](/docs/pay)) |
| Money | **USDC**. Arc also pays its gas in USDC |
| The website, API and agents | A Node server and a Next.js site, open source on [GitHub](https://github.com/neromtoobad/syncly) |

> **Live** Syncly has run on Arc mainnet since 28 September 2026. The [traction report](/api/traction.md) is generated from the live books and never includes demo data.
