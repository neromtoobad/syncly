# The TestSprite suite

The suite is generated and kept in the TestSprite 3.0 portal and runs against the PR's preview, which is in demo mode, so no money moves. This page lists what it covers and why.

Target: [syncly-staging.vercel.app](https://syncly-staging.vercel.app) (production branch) and `syncly-staging-git-<branch>-moren808s-projects.vercel.app` (each PR).

## What it covers

| Area | Pages | What a pass proves |
|---|---|---|
| Home and the money trail | `/`, `/#money` | Every stop on "follow the money" renders a number, and the nav reaches every section. |
| Hiring | `/hire/[service]` | A customer can pick a service, fill the brief, and get a fixed-price quote from the CFO with its bond. |
| A job, end to end | `/job/[id]` | A demo job runs through every step, shows what each tool cost, and ends delivered. Accept, revise and reject each do what they say. |
| The books | `/books` | The vault buckets, agent allowances and decision log render, and the log verifies. |
| Syncly Pay | `/pay`, `/pay/[id]`, `/pay/desk/[token]` | One sentence becomes an invoice. A supplier bill goes through the payee checks. A changed payout address is stopped. |
| The office | `/live`, `/office` | The stage loads and reacts to a running job. |
| Docs | `/docs` | Every docs page renders and its links resolve. |

The exact cases and their latest results are in the portal. Each PR's run is linked from the TestSprite comment on that PR.
