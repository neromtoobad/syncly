# Syncly: product requirements for end-to-end tests

## What Syncly is
Syncly is a company staffed by AI agents. Small businesses hire it for fixed-price jobs from 1 USDC. An AI CFO prices every job, holds the customer's payment in escrow, pays the agents and their suppliers, and signs every decision.

## The environment under test
- Tests run against a **demo-mode** deployment: `https://syncly-staging.vercel.app`, and a preview per pull request.
- In demo mode no money moves.
  - The agents' tools return fixtures.
  - "Pay" buttons are labelled **(demo)** and settle a simulated payment.
  - No email is sent.
- `GET /api/health` returns `{"ok":true,"mode":"demo",...}`. A test should fail if `mode` is ever `live`: that would mean a preview is pointed at the real company.
- No sign-in is needed anywhere.

## Core user journeys (highest priority)

### 1. Hire the team for a job and watch it get done
1. On the home page, open a service from the services list. For example, **Best Price & Seller Check** is at `/hire/buy-smart`, and **Find Customers** is at `/hire/find-customers`.
2. The hire page shows the service name as the heading, what you get, and the agents on the team.
3. Fill **The job** (a textarea; the example chips fill it in one click) and **Your email**.
4. **Get my quote** stays disabled until the brief is at least 12 characters and the email contains `@`.
5. Click **Get my quote**. The button reads "The CFO is pricing it…", then a quote appears with:
   - the price in USDC (1 USDC for these services);
   - the CFO's bond (a share of the price it puts at stake);
   - the delivery time.
6. Click **Pay 1 USDC into escrow (demo)**. You land on the job page `/job/<id>`.
7. The job page shows the team working live, step by step, and the money on this job: the quote, the bond, and each tool the agents bought.
8. Within about a minute the job reaches **delivered** and shows the deliverable.
9. **Change the brief** on the quote returns to the form with the brief kept.

### 2. Business Website order (structured form)
At `/hire/website`, the form is **Tell us about your business**. It asks for the business details instead of a free-text brief, and its button is **Get my quote**. A quote appears in the same way as above.

### 3. Follow the money and read the books
- The home page's **follow the money** section (`/#money`) shows a number at every stop.
- `/books` is the owner's private ledger. Without the owner passcode it shows "The books are private." and asks for the passcode. That is correct: a test must not try to get past it.
- The public view of the money is `GET /api/cfo`. It returns JSON with `policy`, `verify` and `metrics`, and `verify.ok` is `true`.

### 4. Syncly Pay
- `/pay` explains Syncly Pay (invoices in, supplier bills out, autopay inside the owner's limits).
- The invoice box takes one sentence, such as "Ada, 2 party trays at ₦25,000 each, due Friday".
- The page must render without errors, and its calls to action must be reachable.

### 5. The office and the docs
- `/live` shows the office stage full screen, with no site navigation.
- `/office` shows the office inside the site.
- Both load without errors.
- `/docs` renders, and its section links open their pages.

## Rules that must hold everywhere
- Every page loads with no uncaught error.
- The header's **Menu** button opens the site menu.
- The footer links work: Services, How it works, The AI CFO, Follow the money, The team.
- A service id that doesn't exist (for example `/hire/nope`) shows "We don't do that one." and a link back to the services.
- Every "Pay" control in this environment is labelled **(demo)**. Nothing asks for a wallet to pay.
- A job id that doesn't exist (for example `/job/ord_missing`) shows "Couldn't find this job." with a **Back to Syncly** link, not a crash.

## Out of scope
- Connecting a real wallet, real escrow on Arc mainnet, and real email delivery. None of these exist in demo mode.
- Accepting, revising or rejecting a delivered job. Those are confirmed through the customer's email, which demo mode doesn't send.
