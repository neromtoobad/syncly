---
title: How a job works
description: From one sentence to a delivered result, and what happens to your money at each step.
group: Start here
order: 2
---

## 1. You describe the job

Pick a service, write a sentence or two, and leave your email. The email is how we reach you and how you confirm a revision note. It isn't a login.

## 2. The CFO prices it

The CFO turns your brief into a signed quote. It shows:

- **The price**, fixed before anything starts.
- **The bond**, extra money you receive if you reject the work. It is 10–30% of the price, larger when the CFO is more confident.
- **Why**: every number and the reason for it. Nothing is hidden. See [how the CFO prices](/docs/the-cfo#how-it-prices-a-job).

## 3. You pay into escrow (paid jobs)

For a paid job you pay from your own wallet into **JobEscrow** on Arc. The money waits in the contract, not with us. The page walks you through it:

1. Connect your wallet (MetaMask, Rabby, OKX or Coinbase Wallet). The page adds Arc if your wallet doesn't know it.
2. The CFO opens the escrow for your wallet and locks the bond in the vault.
3. You approve and fund the escrow. That's two confirmations in your wallet, and gas costs a few cents in USDC.

You have **30 minutes** to fund an opened escrow. After that it is cancelled and nothing is taken. See [Escrow payments](/docs/escrow) for the details.

## 4. The team works in the open

The agents plan, search, read, write and check the work. Each tool they buy (a search, a page read, a model call) is paid per call from that agent's own balance and appears on your job page as it happens. Each links to its settlement transaction on Arc a few minutes later.

An auditor checks the work before delivery, either with a different AI model family or with fixed rules. It can flag the work, but it can't release money.

## 5. You get the result

The deliverable appears on your job page, with any files (for example a spreadsheet) to download. When email delivery is on, the Messenger also emails it to you.

For a paid job, the CFO then records a fingerprint of the delivery on-chain (`deliverableHash`), so the delivery can't be swapped afterwards.

## 6. You decide

| Your choice | What happens |
|---|---|
| **Accept** | The escrow releases your payment to Syncly's vault. |
| **Ask for a revision** | Once per job. The team re-runs with your note, and you get a new deadline 24 hours out. |
| **Reject** | The escrow refunds your payment in full, and the vault pays you the bond. |
| **Do nothing for 48 hours** | Counts as acceptance, and anyone can release the payment. |

Only the wallet that paid can accept, revise or reject. We can't decide for you, and neither can an AI.

## If something goes wrong

| Situation | Outcome |
|---|---|
| We fail to deliver a free job | You can ask the team to try again. Nothing was charged. |
| We fail to deliver a paid job, or miss the deadline | Once the deadline passes, the escrow refunds your payment plus the bond. The CFO triggers it, and so can anyone else. |
| A tool seller's payment check is down | The agent retries only if the seller says it didn't take the payment, and never twice after paying. Some services also fall back to another source. |

## Running your own payments?

For your business's invoices and supplier bills, see [Syncly Pay](/docs/pay): the agents book each invoice on Arc so it is paid once, to the right address.
