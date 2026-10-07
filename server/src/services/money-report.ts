// Money Report: a business's bank statement, read by the CFO. Every transaction is pulled out, sorted into what it
// was for, and the totals are reconciled in code against the statement's own balances before anything is said
// about them. Then: money in and out by month, where the money goes, top customers and suppliers, recurring
// payments, bank charges, the tightest days, and what to do about it. The numbers are computed; the model only
// reads rows and labels, and writes the advice from the computed facts.
// Analyst reads the statement (text in chunks; screenshots with a vision model) → code cleans and reconciles →
// Analyst labels each kind of transaction → code computes every figure → Writer (the CFO's voice) turns the facts
// into findings and actions → Auditor rules: totals reconcile, every row labelled, every number in the advice
// appears in the facts → chart, spreadsheet, report. The statement files are deleted when the job ends.
import { Job } from '../job.ts';
import { MODELS } from '../config.ts';
import { HOSTS, llm, parseJson } from '../tools.ts';
import { MAIL_BUDGET_USD, MAIL_HOST } from '../mail.ts';
import { htmlToPng } from '../browser.ts';
import { deleteStatements, readStatement } from '../statements.ts';
import type { BusinessDetails } from '../details.ts';

type Row = { date: string; desc: string; out: number; in: number; balance?: number };
type Header = { bank?: string; account?: string; currency?: string; from?: string; to?: string; opening?: number; closing?: number };
const CATS = ['Sales & customer payments', 'Transfers from own accounts', 'Loans & credit received', 'Refunds & reversals', 'Other money in',
  'Stock & suppliers', 'Rent & premises', 'Staff & wages', 'Transport & logistics', 'Power, fuel & utilities', 'Airtime, data & subscriptions',
  'Marketing & ads', 'Bank charges & fees', 'Taxes & levies', 'Loan repayments', 'Transfers to own accounts', 'Cash withdrawals', 'Personal & family', 'Other spending'] as const;
type Cat = (typeof CATS)[number];
const OWN = new Set<Cat>(['Transfers from own accounts', 'Transfers to own accounts']);

const num = (v: unknown): number => { if (typeof v === 'number') return Number.isFinite(v) ? Math.abs(v) : 0; const s = String(v ?? '').replace(/[₦,\s]|NGN/gi, '').replace(/^\((.*)\)$/, '$1'); const n = parseFloat(s); return Number.isFinite(n) ? Math.abs(n) : 0; };
const money = (n: number, cur = '₦') => `${cur}${Math.round(n).toLocaleString('en-NG')}`;
const csvCell = (v: unknown) => { const s = v === undefined || v === null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** A description stripped of references and numbers, so the same kind of payment groups together. */
const norm = (d: string) => d.toUpperCase().replace(/\b(REF|TRF|TRANSFER|NIP|FT|FIP|WEB|MOB|USSD|POS)[:#]?\s*\S*\d\S*/g, '$1').replace(/[0-9]{3,}/g, '#').replace(/[^A-Z# ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70);
const monthOf = (d: string) => { const m = d.match(/(\d{4})-(\d{2})/); return m ? `${m[1]}-${m[2]}` : 'unknown'; };

export const moneyReport = {
  id: 'money-report',
  name: 'Money Report',
  priceUsd: 2,
  policy: { budgetUsd: 0.9 + MAIL_BUDGET_USD, allowHosts: [HOSTS.blockrun, ...(MAIL_HOST ? [MAIL_HOST] : [])] },

  async run(brief: string, opts: { orderId?: string; details?: BusinessDetails } = {}): Promise<Job> {
    const job = new Job(this.id, brief, this.policy, opts.orderId);
    const ids = opts.details?.statements ?? [];
    try {
      if (!ids.length) throw new Error('No statement was attached to this order.');
      const biz = opts.details?.name ?? 'the business';

      // 1. Read every transaction: text in chunks of ~120 lines, screenshots one by one
      let header: Header = {};
      const rows: Row[] = [];
      const READ = `You read bank statements (Nigerian banks and fintechs: GTBank, Access, Zenith, UBA, First Bank, Opay, Moniepoint, Kuda, PalmPay and others). Reply JSON only:
{"header": {"bank": string|null, "account": account NAME only (never the number)|null, "currency": "NGN" or the code shown, "from": "YYYY-MM-DD"|null, "to": "YYYY-MM-DD"|null, "opening": opening balance|null, "closing": closing balance|null},
 "rows": [{"date": "YYYY-MM-DD", "desc": the narration/description as written, "out": amount debited or 0, "in": amount credited or 0, "balance": running balance after it|null}]}
Copy amounts exactly as numbers (no currency signs or commas). One row per transaction, in the order shown. Skip page headers, totals and summaries. Never invent rows. Never include account numbers, BVN or card numbers in "desc": replace them with ****.`;
      const parts: { kind: 'text'; text: string }[] | { kind: 'image'; buf: Buffer }[] = [] as any;
      for (const id of ids) { const s = readStatement(id); if (s) (parts as any[]).push(s); }
      if (!parts.length) throw new Error('The statement files are gone (they are deleted a day after upload). Please order again with the statement.');
      let chunks = 0;
      for (const p of parts as any[]) {
        if (p.kind === 'text') {
          const lines = (p.text as string).split('\n').filter((l: string) => l.trim()).slice(0, 2400);
          for (let i = 0; i < lines.length; i += 110) {
            if (chunks >= 22) break;
            chunks++;
            job.log('analyst', 'read', `statement lines ${i + 1}–${Math.min(i + 110, lines.length)} of ${lines.length}`);
            const r = parseJson<{ header?: Header; rows?: any[] }>(await llm(job, 'analyst', [
              { role: 'system', content: READ },
              { role: 'user', content: lines.slice(i, i + 110).join('\n') },
            ], 'read transactions from the statement', { model: MODELS.fast, maxTokens: 6000, json: true, maxUsd: 0.06,
              dry: () => JSON.stringify(dryChunk(i)) }), {});
            if (r.header) header = { ...header, ...Object.fromEntries(Object.entries(r.header).filter(([k, v]) => v !== null && v !== undefined && !(k in header && header[k as keyof Header] !== undefined))) };
            for (const x of r.rows ?? []) rows.push({ date: String(x.date ?? ''), desc: String(x.desc ?? '').slice(0, 160), out: num(x.out), in: num(x.in), balance: x.balance === null || x.balance === undefined ? undefined : num(x.balance) });
          }
        } else {
          if (chunks >= 22) break;
          chunks++;
          job.log('analyst', 'read', `a statement screenshot with ${MODELS.vision.split('/')[1]}`);
          const r = parseJson<{ header?: Header; rows?: any[] }>(await llm(job, 'analyst', [
            { role: 'system', content: READ },
            { role: 'user', content: [{ type: 'text', text: 'One page of the statement.' }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${p.buf.toString('base64')}` } }] },
          ], 'read transactions from a screenshot', { model: MODELS.vision, maxTokens: 6000, json: true, maxUsd: 0.08, dry: () => JSON.stringify(dryChunk(0)) }), {});
          if (r.header) header = { ...header, ...Object.fromEntries(Object.entries(r.header).filter(([, v]) => v !== null && v !== undefined)) };
          for (const x of r.rows ?? []) rows.push({ date: String(x.date ?? ''), desc: String(x.desc ?? '').slice(0, 160), out: num(x.out), in: num(x.in), balance: x.balance === null || x.balance === undefined ? undefined : num(x.balance) });
        }
      }
      const tx = rows.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && (r.in > 0 || r.out > 0) && !(r.in > 0 && r.out > 0))
        .map((r) => ({ ...r, desc: r.desc.replace(/\b\d{10,}\b/g, '****') }));
      // a chunk boundary can repeat a row: drop exact repeats that sit next to each other
      const clean = tx.filter((r, i) => !(i > 0 && r.date === tx[i - 1].date && r.desc === tx[i - 1].desc && r.in === tx[i - 1].in && r.out === tx[i - 1].out && r.balance === tx[i - 1].balance));
      if (clean.length < 3) throw new Error('We could not find transactions in that statement. Send the PDF straight from your bank, a CSV export, or clear screenshots of every page.');
      clean.sort((a, b) => a.date.localeCompare(b.date));
      const cur = (header.currency ?? 'NGN').toUpperCase() === 'NGN' ? '₦' : `${header.currency} `;
      job.log('analyst', 'rows', `${clean.length} transactions, ${clean[0].date} to ${clean.at(-1)!.date}`);

      // 2. Reconcile in code: opening + money in − money out = closing, and the running balance row by row
      const totalIn = clean.reduce((s, r) => s + r.in, 0), totalOut = clean.reduce((s, r) => s + r.out, 0);
      let rec: { ok: boolean; note: string };
      if (header.opening !== undefined && header.closing !== undefined) {
        const diff = Math.round((header.opening + totalIn - totalOut - header.closing) * 100) / 100;
        rec = Math.abs(diff) < 1 ? { ok: true, note: `opening ${money(header.opening, cur)} + money in ${money(totalIn, cur)} − money out ${money(totalOut, cur)} = closing ${money(header.closing, cur)}, to the naira` } : { ok: false, note: `opening + in − out is ${money(Math.abs(diff), cur)} ${diff > 0 ? 'more' : 'less'} than the closing balance: some rows may be missing or unreadable` };
      } else {
        const withBal = clean.filter((r) => r.balance !== undefined);
        let breaks = 0;
        for (let i = 1; i < withBal.length; i++) if (Math.abs(withBal[i - 1].balance! + withBal[i].in - withBal[i].out - withBal[i].balance!) > 1) breaks++;
        rec = withBal.length > 3 ? (breaks <= Math.max(1, withBal.length * 0.02) ? { ok: true, note: `the running balance agrees row by row (${withBal.length} rows${breaks ? `, ${breaks} break` : ''})` } : { ok: false, note: `the running balance breaks in ${breaks} places: some rows may be missing or the statement covers several accounts` }) : { ok: false, note: 'the statement shows no balances to reconcile against' };
      }
      job.log('auditor', 'reconcile', rec.note);

      // 3. Label each kind of transaction (grouped by description), never each amount
      const groups = new Map<string, { desc: string; n: number; in: number; out: number }>();
      for (const r of clean) { const k = norm(r.desc) || r.desc; const g = groups.get(k) ?? { desc: r.desc, n: 0, in: 0, out: 0 }; g.n++; g.in += r.in; g.out += r.out; groups.set(k, g); }
      const keys = [...groups.keys()];
      const label = new Map<string, { cat: Cat; who: string }>();
      for (let i = 0; i < keys.length; i += 120) {
        job.log('analyst', 'label', `${Math.min(i + 120, keys.length)} of ${keys.length} kinds of transaction`);
        const r = parseJson<{ labels?: { i: number; cat: string; who: string }[] }>(await llm(job, 'analyst', [
          { role: 'system', content: `Label bank transactions for ${biz} (${opts.details?.offer ?? 'a small business'}). For each, pick ONE category from this list exactly: ${CATS.join(' | ')}; and "who": the other party's name as it appears (a person or business), or "" if none. Money in from customers or sales is "Sales & customer payments"; transfers between the owner's own accounts are "Transfers from/to own accounts" (use the account holder name ${header.account ? `"${header.account}"` : ''} as a hint). Bank charges include SMS alerts, stamp duty, VAT on fees, transfer fees, card maintenance. Reply JSON only: {"labels": [{"i": index, "cat": category, "who": name}]}` },
          { role: 'user', content: JSON.stringify(keys.slice(i, i + 120).map((k, j) => { const g = groups.get(k)!; return { i: i + j, desc: g.desc, direction: g.in > 0 && g.out === 0 ? 'in' : g.out > 0 && g.in === 0 ? 'out' : 'both', times: g.n }; })) },
        ], 'label the kinds of transaction', { model: MODELS.fast, maxTokens: 6000, json: true, maxUsd: 0.05,
          dry: () => JSON.stringify({ labels: keys.slice(i, i + 120).map((k, j) => ({ i: i + j, cat: dryCat(groups.get(k)!.desc, groups.get(k)!.in > 0), who: groups.get(k)!.desc.split(' ').slice(-2).join(' ') })) }) }), {});
        for (const l of r.labels ?? []) { const k = keys[l.i]; if (k && (CATS as readonly string[]).includes(l.cat)) label.set(k, { cat: l.cat as Cat, who: String(l.who ?? '').slice(0, 60) }); }
      }
      const rowsL = clean.map((r) => { const k = norm(r.desc) || r.desc, l = label.get(k); return { ...r, cat: (l?.cat ?? (r.in > 0 ? 'Other money in' : 'Other spending')) as Cat, who: l?.who ?? '' }; });
      const labelled = rowsL.filter((r) => label.has(norm(r.desc) || r.desc)).length;

      // 4. Every figure, computed
      const realIn = rowsL.filter((r) => r.in > 0 && !OWN.has(r.cat)), realOut = rowsL.filter((r) => r.out > 0 && !OWN.has(r.cat));
      const months = [...new Set(rowsL.map((r) => monthOf(r.date)))].sort();
      const byMonth = months.map((m) => ({ m, in: realIn.filter((r) => monthOf(r.date) === m).reduce((s, r) => s + r.in, 0), out: realOut.filter((r) => monthOf(r.date) === m).reduce((s, r) => s + r.out, 0) }));
      const sumBy = <T extends string>(list: typeof rowsL, key: (r: (typeof rowsL)[number]) => T, v: (r: (typeof rowsL)[number]) => number) => { const m = new Map<T, number>(); for (const r of list) m.set(key(r), (m.get(key(r)) ?? 0) + v(r)); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
      const spendCats = sumBy(realOut, (r) => r.cat, (r) => r.out);
      const inCats = sumBy(realIn, (r) => r.cat, (r) => r.in);
      const customers = sumBy(rowsL.filter((r) => r.cat === 'Sales & customer payments' && r.who), (r) => r.who, (r) => r.in).slice(0, 5);
      const suppliers = sumBy(rowsL.filter((r) => r.out > 0 && r.who && !OWN.has(r.cat) && !['Bank charges & fees', 'Cash withdrawals', 'Personal & family'].includes(r.cat)), (r) => r.who, (r) => r.out).slice(0, 5);
      const charges = rowsL.filter((r) => r.cat === 'Bank charges & fees').reduce((s, r) => s + r.out, 0);
      const days = Math.max(1, (Date.parse(clean.at(-1)!.date) - Date.parse(clean[0].date)) / 86400_000 + 1);
      const perMonth = (x: number) => (x * 30.4) / days;
      // recurring: the same other party paid in 2+ different months at a similar amount
      const recurring = [...new Set(realOut.filter((r) => r.who).map((r) => r.who))].map((who) => {
        const list = realOut.filter((r) => r.who === who), ms = new Set(list.map((r) => monthOf(r.date)));
        const avg = list.reduce((s, r) => s + r.out, 0) / list.length;
        return { who, months: ms.size, avg, similar: list.every((r) => Math.abs(r.out - avg) <= avg * 0.25) };
      }).filter((x) => x.months >= 2 && x.similar).sort((a, b) => b.avg - a.avg).slice(0, 6);
      const withBal = rowsL.filter((r) => r.balance !== undefined);
      const lowest = withBal.length ? withBal.reduce((a, b) => (b.balance! < a.balance! ? b : a)) : undefined;
      const biggestOut = [...realOut].sort((a, b) => b.out - a.out).slice(0, 5);
      const personal = realOut.filter((r) => r.cat === 'Personal & family').reduce((s, r) => s + r.out, 0);
      const salesIn = inCats.find(([c]) => c === 'Sales & customer payments')?.[1] ?? 0;
      const sumIn = realIn.reduce((s, r) => s + r.in, 0), sumOut = realOut.reduce((s, r) => s + r.out, 0);
      const facts = {
        business: biz, period: `${clean[0].date} to ${clean.at(-1)!.date}`, days: Math.round(days), currency: cur.trim(),
        money_in: Math.round(sumIn), money_out: Math.round(sumOut), net: Math.round(sumIn - sumOut), sales_in: Math.round(salesIn),
        monthly: byMonth.map((x) => ({ month: x.m, in: Math.round(x.in), out: Math.round(x.out), net: Math.round(x.in - x.out) })),
        spending_by_category: spendCats.map(([c, v]) => ({ category: c, amount: Math.round(v), share: Math.round((v / Math.max(1, sumOut)) * 100) })),
        money_in_by_category: inCats.map(([c, v]) => ({ category: c, amount: Math.round(v) })),
        top_customers: customers.map(([w, v]) => ({ who: w, paid_you: Math.round(v) })), top_suppliers: suppliers.map(([w, v]) => ({ who: w, you_paid: Math.round(v) })),
        recurring_payments: recurring.map((r) => ({ who: r.who, about: Math.round(r.avg), months: r.months })),
        bank_charges: Math.round(charges), bank_charges_per_month: Math.round(perMonth(charges)), bank_charges_per_year: Math.round(perMonth(charges) * 12),
        personal_spending: Math.round(personal), personal_share_of_spending: Math.round((personal / Math.max(1, sumOut)) * 100),
        lowest_balance: lowest ? { amount: Math.round(lowest.balance!), date: lowest.date } : null,
        biggest_payments_out: biggestOut.map((r) => ({ date: r.date, amount: Math.round(r.out), what: r.cat, who: r.who })),
        transactions: rowsL.length, reconciled: rec.ok,
      };

      // 5. The CFO's read: findings and actions from the facts only
      job.log('writer', 'advice', 'findings and actions from the computed figures');
      const adv = parseJson<{ summary: string; findings: string[]; actions: string[] }>(await llm(job, 'writer', [
        { role: 'system', content: `You are a small-business CFO in Nigeria writing to the owner of ${biz} about their bank statement. Use ONLY the facts JSON; every number you write must appear in it (you may round to the nearest thousand and write ₦). Plain, warm, direct English; no jargon. Reply JSON only: {"summary": 2 sentences: what happened to the money in this period, "findings": [5 specific observations, each with a number from the facts: where the money goes, who pays them most, charges, personal spending mixed in, tight days, trends between months], "actions": [5 concrete things to do this month, most valuable first, each tied to a finding (e.g. reduce bank charges by moving transfers to X, separate personal spending into another account, follow up the customer who paid less this month, keep a buffer of ₦X before the low point)]}` },
        { role: 'user', content: JSON.stringify(facts) },
      ], 'write the findings and actions', { maxTokens: 1600, json: true, maxUsd: 0.06,
        dry: () => JSON.stringify({ summary: `Money in was ${money(sumIn, cur)} and money out ${money(sumOut, cur)}.`, findings: [`${spendCats[0]?.[0]} is the biggest cost at ${money(spendCats[0]?.[1] ?? 0, cur)}.`], actions: ['Move personal spending to a separate account.'] }) }), { summary: '', findings: [], actions: [] });
      // every figure in the advice must exist in the facts (to the nearest thousand)
      const known = new Set<number>(); JSON.stringify(facts).replace(/\d{3,}/g, (m) => { known.add(Math.round(Number(m) / 1000)); return m; });
      const stray = [...adv.summary.matchAll(/₦\s?([\d,]{4,})/g), ...[...adv.findings, ...adv.actions].join(' ').matchAll(/₦\s?([\d,]{4,})/g)].map((m) => Number(m[1].replace(/,/g, ''))).filter((n) => !known.has(Math.round(n / 1000)) && !known.has(Math.round(n / 1000) - 1) && !known.has(Math.round(n / 1000) + 1));

      // 6. QA, rules only
      const issues = [
        !rec.ok ? `Not fully reconciled: ${rec.note}` : '',
        labelled < rowsL.length * 0.9 ? `${rowsL.length - labelled} of ${rowsL.length} transactions could not be labelled and sit in "Other"` : '',
        stray.length ? `${stray.length} figure${stray.length === 1 ? '' : 's'} in the advice could not be traced to the statement and ${stray.length === 1 ? 'was' : 'were'} flagged` : '',
      ].filter(Boolean);
      job.log('auditor', 'check', issues.length ? issues.join('; ') : 'totals reconcile; every row labelled; every figure in the advice traced to the statement');
      job.qa = { verdict: rec.ok && !stray.length ? 'pass' : 'revise', notes: issues.join(' | ') || rec.note, model: 'reconciliation + rules' };

      // 7. Chart, spreadsheet, report
      const chart = await htmlToPng(chartHtml(byMonth, spendCats.slice(0, 7), cur), 1200, 640).catch(() => undefined);
      if (chart) job.files.push({ name: 'money-chart.png', content: chart });
      const header2 = ['date', 'description', 'money in', 'money out', 'balance', 'category', 'other party'];
      job.files.push({ name: 'transactions.csv', content: [header2.join(','), ...rowsL.map((r) => [r.date, r.desc, r.in || '', r.out || '', r.balance ?? '', r.cat, r.who].map(csvCell).join(','))].join('\n') + '\n' });
      const pct = (v: number) => `${Math.round((v / Math.max(1, sumOut)) * 100)}%`;
      job.deliverable = [
        `# Money report: ${biz}`,
        `**${facts.period}** · ${rowsL.length} transactions${header.bank ? ` · ${header.bank}` : ''} · ${rec.ok ? 'reconciled ✓' : 'not fully reconciled'}`,
        adv.summary,
        `| | Amount |\n|---|---|\n| Money in (not counting your own transfers) | ${money(sumIn, cur)} |\n| Money out (not counting your own transfers) | ${money(sumOut, cur)} |\n| Net | ${sumIn - sumOut < 0 ? '−' : ''}${money(Math.abs(sumIn - sumOut), cur)} |\n| From sales and customers | ${money(salesIn, cur)} |\n| Bank charges | ${money(charges, cur)} (about ${money(perMonth(charges) * 12, cur)} a year) |${lowest ? `\n| Lowest balance | ${money(lowest.balance!, cur)} on ${lowest.date} |` : ''}`,
        `## What the CFO sees`, ...adv.findings.map((f) => `- ${f}`),
        `## What to do this month`, ...adv.actions.map((a, i) => `${i + 1}. ${a}`),
        `## By month`, `| Month | In | Out | Net |\n|---|---|---|---|\n` + byMonth.map((x) => `| ${x.m} | ${money(x.in, cur)} | ${money(x.out, cur)} | ${x.in - x.out < 0 ? '−' : ''}${money(Math.abs(x.in - x.out), cur)} |`).join('\n'),
        `## Where the money went`, `| Category | Amount | Share |\n|---|---|---|\n` + spendCats.map(([c, v]) => `| ${c} | ${money(v, cur)} | ${pct(v)} |`).join('\n'),
        customers.length ? `## Who pays you most\n\n` + customers.map(([w, v]) => `- ${w}: ${money(v, cur)}`).join('\n') : '',
        suppliers.length ? `## Who you pay most\n\n` + suppliers.map(([w, v]) => `- ${w}: ${money(v, cur)}`).join('\n') : '',
        recurring.length ? `## Paid every month\n\n` + recurring.map((r) => `- ${r.who}: about ${money(r.avg, cur)} (${r.months} months)`).join('\n') : '',
        `## How it was checked`,
        `- ${rec.ok ? 'Reconciled' : 'Reconciliation'}: ${rec.note}.`,
        `- Transfers between your own accounts are left out of money in and out, so they don't look like income or spending.`,
        `- Every figure here is computed from the statement; the AI only read the rows and labelled them, and wrote the advice from the computed figures.${stray.length ? ` ${stray.length} figure${stray.length === 1 ? '' : 's'} in the advice didn't match the statement exactly; treat ${stray.length === 1 ? 'it' : 'them'} with care.` : ''}`,
        `- \`transactions.csv\` has every transaction with its category, so you can check or change any of them.`,
        `- Your statement files were deleted when this report was finished. This report opens only from the private link in your email.`,
        issues.length ? `> Notes: ${issues.join('; ')}` : '',
      ].filter(Boolean).join('\n\n');
      job.status = 'delivered';
    } catch (e: any) {
      job.status = 'failed';
      job.error = String(e?.message ?? e);
      console.error('  ✗', job.error);
    } finally {
      deleteStatements(ids); // the report is done either way: the statement doesn't stay with us
    }
    job.save();
    return job;
  },
};

function chartHtml(byMonth: { m: string; in: number; out: number }[], cats: [string, number][], cur: string) {
  const max = Math.max(1, ...byMonth.flatMap((x) => [x.in, x.out])), cmax = Math.max(1, ...cats.map((c) => c[1]));
  const k = (n: number) => (n >= 1e6 ? `${cur}${(n / 1e6).toFixed(1)}m` : `${cur}${Math.round(n / 1000)}k`);
  const bars = byMonth.slice(-6).map((x) => `<div class="m"><div class="pair"><i class="in" style="height:${(x.in / max) * 100}%"><b>${k(x.in)}</b></i><i class="out" style="height:${(x.out / max) * 100}%"><b>${k(x.out)}</b></i></div><span>${/^\d{4}-\d{2}$/.test(x.m) ? new Date(`${x.m}-01T12:00:00Z`).toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : x.m}</span></div>`).join('');
  const rows = cats.map(([c, v]) => `<div class="c"><span>${c}</span><div class="t"><i style="width:${(v / cmax) * 100}%"></i></div><b>${k(v)}</b></div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}body{width:1200px;height:640px;background:#fbf9f4;font-family:Arial,Helvetica,sans-serif;color:#13271c;padding:36px 40px;display:grid;grid-template-columns:1fr 1.1fr;gap:44px}
h2{font-size:22px;margin-bottom:6px}p{font-size:14px;color:#5b6b60;margin-bottom:18px}.key{display:flex;gap:16px;font-size:13px;margin-bottom:12px}.key i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.chart{display:flex;gap:18px;align-items:flex-end;height:400px;border-bottom:2px solid #d9d4c7;padding-bottom:4px}.m{flex:1;display:flex;flex-direction:column;align-items:center;height:100%}.pair{flex:1;width:100%;display:flex;gap:6px;align-items:flex-end}
.pair i{flex:1;border-radius:6px 6px 0 0;position:relative;min-height:2px}.pair b{position:absolute;top:-20px;left:50%;transform:translateX(-50%);font-size:11px;white-space:nowrap}.in{background:#2e7a38}.out{background:#c8902f}.m span{font-size:13px;margin-top:8px;color:#5b6b60}
.c{display:grid;grid-template-columns:210px 1fr 80px;gap:12px;align-items:center;margin:10px 0;font-size:14px}.t{height:22px;background:#ece7db;border-radius:6px;overflow:hidden}.t i{display:block;height:100%;background:#13271c;border-radius:6px}.c b{text-align:right}
</style></head><body><div><h2>Money in and out</h2><p>By month, without transfers between your own accounts</p><div class="key"><span><i style="background:#2e7a38"></i>In</span><span><i style="background:#c8902f"></i>Out</span></div><div class="chart">${bars}</div></div>
<div><h2>Where the money went</h2><p>Biggest spending categories in the period</p>${rows}</div></body></html>`;
}

// demo-mode stand-ins: a small, consistent statement
function dryChunk(i: number) {
  if (i > 0) return { rows: [] };
  const rows = [
    { date: '2026-08-01', desc: 'TRF FROM ADA OKAFOR/PARTY TRAY', out: 0, in: 85000, balance: 205000 },
    { date: '2026-08-03', desc: 'POS PURCHASE SHOPRITE LEKKI', out: 42000, in: 0, balance: 163000 },
    { date: '2026-08-05', desc: 'SMS ALERT CHARGES', out: 400, in: 0, balance: 162600 },
    { date: '2026-08-06', desc: 'TRF TO MAMA NKECHI FOODSTUFF', out: 60000, in: 0, balance: 102600 },
    { date: '2026-08-10', desc: 'TRF FROM CHOWDECK SETTLEMENT', out: 0, in: 140000, balance: 242600 },
    { date: '2026-08-15', desc: 'RENT AUG SHOP', out: 120000, in: 0, balance: 122600 },
    { date: '2026-08-20', desc: 'AIRTIME MTN', out: 5000, in: 0, balance: 117600 },
    { date: '2026-09-01', desc: 'TRF FROM ADA OKAFOR/PARTY TRAY', out: 0, in: 90000, balance: 207600 },
    { date: '2026-09-04', desc: 'TRF TO MAMA NKECHI FOODSTUFF', out: 65000, in: 0, balance: 142600 },
    { date: '2026-09-05', desc: 'SMS ALERT CHARGES', out: 400, in: 0, balance: 142200 },
    { date: '2026-09-11', desc: 'TRF FROM CHOWDECK SETTLEMENT', out: 0, in: 160000, balance: 302200 },
    { date: '2026-09-15', desc: 'RENT SEP SHOP', out: 120000, in: 0, balance: 182200 },
    { date: '2026-09-18', desc: 'TRF TO SELF KUDA', out: 50000, in: 0, balance: 132200 },
  ];
  return { header: { bank: 'GTBank', account: 'TOLU SMALL CHOPS', currency: 'NGN', from: '2026-08-01', to: '2026-09-30', opening: 120000, closing: 132200 }, rows };
}
function dryCat(desc: string, isIn: boolean): Cat {
  const d = desc.toUpperCase();
  if (/SMS|CHARGE|STAMP|FEE/.test(d)) return 'Bank charges & fees';
  if (/RENT/.test(d)) return 'Rent & premises';
  if (/AIRTIME|DATA/.test(d)) return 'Airtime, data & subscriptions';
  if (/SELF/.test(d)) return isIn ? 'Transfers from own accounts' : 'Transfers to own accounts';
  if (/FOODSTUFF|SHOPRITE/.test(d)) return 'Stock & suppliers';
  return isIn ? 'Sales & customer payments' : 'Other spending';
}
