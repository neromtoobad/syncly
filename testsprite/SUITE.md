# The TestSprite suite

The suite lives in the TestSprite 3.0 portal and runs against each PR's preview, which is in demo mode, so no money moves. The agents first explored staging (7 agents, 123 pages) and were steered by [`PRD.md`](PRD.md). They planned 51 tests. We kept the 19 that don't overlap.

Targets:
- the production branch: [syncly-staging.vercel.app](https://syncly-staging.vercel.app);
- each PR: `syncly-staging-git-<branch>-moren808s-projects.vercel.app`.

## The 19 tests

| Area | Test | What a pass proves |
|---|---|---|
| Hire | Hire best-price check and reach delivered | Brief, CFO quote with bond, **Pay (demo)**, then the job page runs every step and ends **delivered**. |
| Hire | Hire find-customers and reach delivered | The same journey for a second service, with its own example briefs. |
| Hire | Quote request requires a long enough brief and valid email | The form won't price "Buy two items." or a bad email, and says what's missing. |
| Hire | Change the brief from the quote returns to the form | Backing out of a quote keeps the brief. |
| Website | Business website quote flow | The structured business form gets a quote. |
| Website | Pay for a business website quote in demo mode | The demo payment opens a job. |
| Website | Track a business website job to delivery | The website job reaches delivered. |
| Money | View follow the money section from the home page | Every stop on the money trail shows a number. |
| Money | Check CFO verification is ok | `/api/cfo` is public and its signed log verifies. |
| Money | Open the books page | The owner's books stay private without the passcode. |
| Safety | Check API health in demo mode | The preview says `mode: demo`. A preview pointed at the live company fails here. |
| Pay | Open Syncly Pay | The Pay page renders with its calls to action. |
| Pay | Create a demo invoice from the Syncly Pay page | One sentence becomes an invoice, the owner confirms it, and it's booked. |
| Office | Open the live office stage | `/live` loads full screen. |
| Office | Open the office page inside the site | `/office` loads inside the site. |
| Docs | Open the docs hub and a section page | Docs pages render and their links resolve. |
| Nav | Use the footer to open docs and service links | The footer reaches every section. |
| Errors | Open a missing hire service | An unknown service shows "We don't do that one." |
| Errors | Open a missing job | An unknown job shows "Couldn't find this job." |

## What it caught on the first PR

The first TestSprite check on [PR #1](https://github.com/neromtoobad/syncly/pull/1) failed (16 passed, 1 failed, 2 blocked) and held the merge. Behind it were two real problems:

- **"Buy it" was enough to get a quote** for Best Price & Seller Check. The shopping list only had to be non-empty, so the Researcher got nothing to price. A free-text brief had the same gap: "Buy two items." passed a 12-character check, although the API's own error asks for a sentence.
- **Syncly Pay told a demo owner to check an inbox that never gets an email,** so the invoice could never be confirmed. The test was blocked at that point.

Both were fixed in the same PR:
- A shopping list must name a product, and a brief must be a short sentence. The form says what's missing.
- In demo mode only, the page shows the confirmation link that the email would carry.

The rerun then caught a third problem, a race that had been there all along: **a paid Business Website order stayed on its form instead of opening the job page.**
- Website orders are private, so their job link carries a key.
- The job page restored that key into the address bar during render, and on a client-side navigation that render happens while the address is still `/hire/website`.
- So it rewrote the hire page's URL and cancelled the move.
- It now only touches the address once the address is that job's.

After that, a sharper money-trail test caught one more: **the Audit trail stop hid a real, verified decision log** whenever the CFO was only observing, and showed a placeholder instead. The log is real either way. Only the weekly-plan line depends on the CFO acting, so now only that line does.

The pinned validation test then found a dead end. A customer can jump straight to a later step with the step chips. If they do, **Get my quote** stays off on the last step with no reason given, because an earlier step was skipped. The last step now names the unfinished step and links back to it.

The other blocked test was the books page. That was the PRD's mistake (it said the books were public), and the PRD and the test were corrected.
