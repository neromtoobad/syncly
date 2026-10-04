---
title: API
description: The public API behind the site. Everything the pages show, you can read yourself.
group: Build and verify
order: 1
---

Base URL: `https://hiresyncly.site`. Responses are JSON unless noted. The books are private to the owner (sent with an `x-owner-key` header); everything else that reads is public, without cost figures. Actions that move a job forward check who is asking: the email on the order, or the wallet that paid, on-chain.

## Read

| Endpoint | Returns |
|---|---|
| `GET /api/health` | `{ ok, mode: "live" \| "demo", keys, treasury }`. `treasury` is the treasury's public address, which proves which keys are loaded without revealing them. |
| `GET /api/services` | The menu: each service's price, team, what you get, and whether it's live |
| `GET /api/escrow` | What a browser needs to pay: chain id, RPC, explorer, and the escrow, vault and USDC addresses |
| `GET /api/stats` | Counts of the team's work: tool payments, payments settled on Arc, jobs delivered, businesses served |
| `GET /api/cfo` | The CFO's mode, policy, latest snapshot of the vault and agents, this week's plan, metrics, the log's verification result, and the last 150 decisions |
| `GET /api/team` | Each agent's jobs, steps, paid calls and sellers |
| `GET /api/orders/:id` | One order: its quote, status, runs (steps, receipt, deliverable), escrow record and decision. The email is masked. |
| `GET /api/orders/:id/files/:name` | A deliverable file, for example `businesses.csv` |
| `GET /api/replay?limit=6` | Recent jobs as event sequences (the office uses this) |

## Live events

`GET /api/events` is a Server-Sent Events stream of everything that moves: `step`, `purchase`, `order` and `cfo` events. Add `?order=<id>` to follow one job.

```bash
curl -N https://hiresyncly.site/api/events
```

## Act

| Endpoint | Body | Notes |
|---|---|---|
| `POST /api/quote` | `{ service, brief, email }` | Returns an order with the CFO's quote |
| `POST /api/orders/:id/start` | `{ mode: "promo" }` | Starts a free first website |
| `POST /api/orders/:id/escrow` | `{ customer }` | The CFO opens the escrow for this wallet (it must hold the price) |
| `POST /api/orders/:id/sync` | `{ tx?, note?, email? }` | After your wallet acts on the escrow, the server reads the chain and follows it. A revision note is sent here first, with the order's email. |
| `POST /api/orders/:id/retry` | `{ email }` | Try a failed free job again |
| `POST /api/orders/:id/accept`, `/revise`, `/reject` | `{ email, note? }` | For free jobs only. Paid jobs are decided on-chain from the wallet that paid. |

## Syncly Pay

| Endpoint | Body | Notes |
|---|---|---|
| `GET /api/pay/config` | | `mode` (`live`, `demo` or `off`), the InvoiceBook address, USDC |
| `POST /api/pay/invoices` | `{ business: { name, email, payee }, customer?: { name?, email? }, text? or lines?, due?, token? }` | The Writer drafts lines from `text`. Without the business's desk `token`, it waits for a confirmation by email before it is booked. |
| `GET /api/pay/invoices/:id` | | The invoice, its sealed document and hash, status, and the booking and payment transactions. No emails. |
| `POST /api/pay/invoices/:id/sync` | `{ tx? }` | After the payer pays, the server reads the chain (the transaction, or recent `Paid` events) and marks it paid. |
| `POST /api/pay/business` | `{ name, email, payee }` | Emails the owner a confirmation link that opens their desk |
| `POST /api/pay/confirm` | `{ b, c }` | The confirmation link: verifies the business and books what was waiting |
| `GET /api/pay/desk/:token` | | The business's desk: totals, invoices, bills, pinned suppliers. The token is private. |
| `GET /api/pay/desk/:token/books.csv` | | Every payment in and out, with its Arc transaction |
| `POST /api/pay/bills` | `{ token, upload, payee? }` | A photo of a supplier's bill (uploaded via `/api/uploads`); the Analyst reads it and the Investigator checks the payee |
| `POST /api/pay/bills/:id/approve` | `{ token, confirmPayee?, notDuplicate?, payee? }` | Books an approved bill on Arc. A changed payout address or a likely duplicate needs the matching confirmation. |
| `POST /api/pay/docs/:id/cancel` | `{ token }` | Cancels an unpaid invoice or bill |

## Site editor

The private link in a website's delivery email (`/edit/<token>`). The token is never shown on the order page.

| Endpoint | Body | Notes |
|---|---|---|
| `GET /api/site-edit/:token` | | The site's editable facts (items, hours, links, bank details) and look, its photos, the themes and the integrations it knows |
| `POST /api/site-edit/:token/preview` | `{ facts?, plan? }` | Only the changed fields. Returns the page re-rendered by the site engine; nothing goes live |
| `POST /api/site-edit/:token/publish` | `{ facts?, plan? }` | Puts the change live and keeps the previous version (the last 10) |
| `POST /api/site-edit/:token/undo` | | Puts the previous version back |
| `POST /api/site-edit/:token/photo` | `{ upload, caption? }` | Adds a photo uploaded via `/api/uploads` |
| `POST /api/site-edit/:token/poster` | `{ format?, target?, headline?, sub?, photo?, bank?, patch? }` | A QR poster preview (`a4`, `a5` or `status`; the code opens `site`, `whatsapp`, `order`, `review` or `pay`), the targets this site can use, and QR scan counts |
| `POST /api/site-edit/:token/poster/file` | same, plus `kind: pdf \| png` | The poster rendered by our headless Chrome: a print PDF or a PNG |
| `POST /api/site-edit/:token/chowdeck` | `{ url }` | Reads a Chowdeck store's menu, ₦ prices and hours for the owner to review; flags a store whose phone isn't the site's |

## Example: get a quote

```bash
curl -s https://hiresyncly.site/api/quote \
  -H 'content-type: application/json' \
  -d '{"service":"website","brief":"A website for Tolu’s Small Chops in Surulere, Lagos. WhatsApp 0803 555 0142, Instagram @tolussmallchops","email":"you@business.com"}'
```

The response includes `quote.priceUsd`, `quote.bondUsd`, `quote.promo` and `quote.reasons`, the CFO's working.
