---
title: FAQ
description: Short answers to the questions people ask first.
group: Start here
order: 4
---

## Do I need crypto to try it?

No. Your first website is free and needs only an email. For paid jobs you need a browser wallet with USDC on Arc.

## How do I get USDC on Arc?

Use [Get USDC on Arc](/arc), which is also one tap away on every checkout:

- **USDC on another chain** (Base, Ethereum, Arbitrum, Optimism, Polygon, Avalanche and more) moves over Circle's CCTP in under a minute. Circle's forwarder mints it on Arc for you, so you need no Arc gas to receive it. The fee is about 0.02 USDC.
- **ETH, POL, AVAX or USDT** is swapped into USDC and lands on Arc in one step.
- **A card or bank transfer** (Apple Pay, Google Pay, debit card, or bank transfer in some places) buys USDC straight into your wallet on Arc, through Circle's Arc Onramp. For now it serves the US, UK and EU, with a one-time ID check by Transak.
- **From an exchange:** Binance, Bybit, OKX, Kraken, KuCoin, Gate and Bitget let you withdraw USDC on the Arc network. In naira, buy USDC on Bybit P2P and withdraw it to Arc.

All of it runs on Circle App Kit from your own wallet; Syncly never holds the money. You need the job's price plus a few cents, because Arc charges gas in USDC.

## Can I change my website after it's delivered?

Yes. Your delivery email has a private link to your site's editor. Change prices, hours and your menu, add the places you already sell (Chowdeck, Glovo, Heyfood, Paystack, Flutterwave, Selar, Bumpa, Jumia, Jiji, your WhatsApp catalogue), booking pages (Calendly, Fresha), tickets (Tix Africa, Eventbrite), your Google review link and your bank details for transfers. Swap photos, the colour and the style, and hide sections. You see a preview first, Publish puts it live in seconds, and Undo puts the last version back. If you sell on Chowdeck, paste your store link and the editor brings in your menu and prices. Keep the link to yourself: anyone with it can change your site.

The editor also has an **announcement bar** (a special, a closure, news) that shows only between the dates you set. Mark yourself closed and the site says "Closed today" instead of "Open now", and Google is told. And it makes **QR posters** in your site's own look: an A4 poster, an A5 counter card or a WhatsApp Status image, with a code that opens your site, a WhatsApp chat, your Chowdeck store, your Google review page or your bank details. Every scan of your site's code is counted in the editor. Each new website comes with an A4 poster and a Status image.

## What if I don't like the work?

Ask for one free revision with a note, or reject it. Rejecting returns your payment in full and pays you the bond on top. See [Escrow payments](/docs/escrow).

## What if Syncly disappears mid-job?

Your money is in the escrow contract, not with us. If the deadline passes without a delivery, anyone can trigger the refund, bond included. If you never decide, anyone can release the payment after 48 hours.

## Who decides whether the work is good?

You do. The Auditor, an AI on a different model family, checks the work and can flag problems, but only your wallet can release a payment.

## Is my job private?

Job pages are public to anyone with the link, because the receipt is the point. Your email is masked everywhere public. Don't put anything in a brief you wouldn't want seen.

## What is x402?

A standard for paying for an API call over HTTP. The seller answers `402 Payment Required` with its price, and the buyer retries with a signed payment. Our agents pay this way through Circle Gateway, which batches many tiny payments and settles them on Arc.

## Why Arc?

Fees are around a cent and paid in USDC, not a volatile token, and settlement takes under a second. That makes paying a fraction of a cent per tool call practical, and lets customers pay with one currency for everything.

## Who is the Boss?

A human's wallet that owns the vault. The CFO needs the Boss's co-signature for anything above its limits, and the Boss sets the policy. The Boss's key is never on the server.

## Can Syncly handle my business's payments?

Yes, with [Syncly Pay](/docs/pay). Send invoices to your customers and pay your suppliers' bills through the agents: the Writer drafts invoices from a sentence, the Investigator checks every supplier's address before you pay, and the Messenger chases unpaid invoices. Each invoice is booked on Arc so it can only be paid once, to the right address.

## Does Syncly hold my money?

No. A Syncly Pay invoice is paid straight from the payer's wallet to yours in one transaction; the contract never holds it. Syncly's 0.5% fee is taken in the same transaction.

## Can I be paid in naira?

Get paid at your Bybit deposit address on Arc (Bybit: Assets → Deposit → USDC → network Arc), then sell the USDC for naira through Bybit P2P whenever you like.

## Is the code open?

Yes, on [GitHub](https://github.com/neromtoobad/syncly): the site, the agents, the CFO and the contracts.
