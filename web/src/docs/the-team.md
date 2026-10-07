---
title: The team
description: Ten AI agents and a CFO, each with its own wallet. They do the work, run businesses' payments, and pay for their own tools within limits they can't exceed.
group: The company
order: 1
---

Every agent has its own wallet on Arc and its own balance in **Circle Gateway**. When an agent needs a tool (a search, a page read, a model call) it pays the seller directly with an **x402 nanopayment**, usually a fraction of a cent. Circle batches those payments and settles them on Arc, and each one appears on the customer's job page (without what it cost).

## Who does what

| Agent | Job | Buys | From |
|---|---|---|---|
| **The CFO** | Prices every job, runs the treasury, books Syncly Pay invoices on Arc (its key is the only one InvoiceBook accepts), never grades the team's work | Nothing: it moves money between the vault's buckets | |
| **Scout** | Finds every business, page, post, listing and source the brief asks for | Search, maps, shopping, social posts, ad libraries | Serper, Exa, AIsa (Instagram, TikTok, Foreplay) |
| **Researcher** | Turns the brief into a plan and pulls out the facts | AI models, AI-assistant answers | BlockRun, DataForSEO via AIsa |
| **Reader** | Opens websites and PDFs and pulls out what matters | Page reading | Exa, APEX |
| **Writer** | Writes posts, ad copy, Google profile descriptions and review replies; drafts Syncly Pay invoices from a sentence | AI models | BlockRun |
| **Analyst** | Compares prices, answers and signals; the numbers on every report; reads suppliers' bills for Syncly Pay | AI models, business records | BlockRun, Openmart |
| **Investigator** | Live-checks emails, phone numbers (SIM swap, call forwarding), domains and sellers, and asks ChatGPT, Gemini, Claude and Perplexity what they tell customers; checks every Syncly Pay payee before a bill is booked | Verification lookups, AI-assistant answers, screening | APEX, BlockRun (Twilio), DataForSEO via AIsa, Didit |
| **Designer** | Websites (Claude Opus 5), product photos, ad creatives and post images | AI models, images | BlockRun on Arc |
| **Producer** | Promo Videos and the video in every Ad Campaign | AI models, video, music | BlockRun on Arc |
| **Auditor** | Checks the work on a different model family, looks at every page and frame, runs Lighthouse | AI models | BlockRun, DataForSEO |
| **Messenger** | Packs the files and emails the delivery from hello@hiresyncly.site; sends Syncly Pay invoices, reminders and receipts | Email sending | Resend (AgentMail by x402 as a fallback) |
| Mailer, Bookkeeper, Linguist | For outreach, bookkeeping and translation services still to come; not in the office yet | | |

The Verifier, who live-checked emails and phone numbers, retired on 1 October 2026; the Investigator does that work now.

The Designer and Producer pay for Claude Opus 5 with a direct USDC transfer from their own wallets, because that's the only way BlockRun sells it on Arc. When a wallet is empty they fall back to Opus 4.8 through their Gateway balance, and the job's log says so.

Their wallet addresses are listed on [On Arc](/docs/on-chain#agent-wallets).

## The limits on every payment

An agent can't spend freely. Each payment passes these checks **before** it is signed:

1. **Allowlist.** The seller's site must be on the service's list. An agent on a Product Photo Studio job can't pay an unrelated site.
2. **Job budget.** The job's total tool spend can't exceed a fixed budget set for each service.
3. **Price cap.** Each call has a maximum price. If a seller asks for more, the agent refuses.
4. **Pinned payee.** Each seller's payout address is pinned. A changed address is refused and flagged for review. See [Safety controls](/docs/safety#who-we-pay).
5. **Blacklist screening.** The payee is checked against Circle's USDC blacklist.

Only then does the agent sign, and a receipt line is written only after the seller delivers.

## Where their money comes from

The agents' Gateway balances are topped up by **the CFO from the vault's TOOLS bucket**, within each agent's weekly allowance. The first balances were funded by the treasury before the vault existed. See [The CFO](/docs/the-cfo#the-treasury-loop).

## The office

The [office](/office) is an animated picture of all this. The CFO stamps each quote, the brief goes up on the whiteboard, the agents work at their desks, the Auditor takes the lift for sign-off, and the Messenger carries the delivery out of the door. Every movement is driven by a real event from the API.
