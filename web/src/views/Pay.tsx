'use client';
// Syncly Pay: a business sends invoices and pays its bills through the agents, booked on InvoiceBook on Arc.
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, Avatar, useApi } from '@/lib.tsx';

export const DESK_KEY = 'syncly:pay-desk';
type DeskInfo = { token: string; name: string; email: string; payee: string };
export const readDesk = (): DeskInfo | null => { try { return JSON.parse(localStorage.getItem(DESK_KEY) ?? 'null'); } catch { return null; } };

const GUARANTEES: [string, string][] = [
  ['No wrong payee', 'The payout address is fixed on Arc when the invoice is booked. A changed link or a forged message can’t send the money anywhere else.'],
  ['No double pay', 'Each invoice can be paid once. The contract refuses a second payment, and the Investigator stops duplicate bills before they’re booked.'],
  ['No phantom invoice', 'Every payment points to the hash of a real invoice document, fixed before any money moves.'],
  ['No rounding', 'Exact USDC to 6 decimals. The 0.5% fee is fixed per invoice and rounds in your favour.'],
];

function InvoiceForm() {
  const router = useRouter();
  const [desk, setDesk] = useState<DeskInfo | null>(null);
  const [f, setF] = useState({ name: '', email: '', payee: '', customerEmail: '', text: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string; demoConfirm?: string } | null>(null);
  useEffect(() => { const d = readDesk(); if (d) { setDesk(d); setF((x) => ({ ...x, name: d.name, email: d.email, payee: d.payee })); } }, []);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const r = await api<{ doc: { id: string }; confirm: boolean; demoConfirm?: string }>('/api/pay/invoices', { method: 'POST', body: JSON.stringify({ business: { name: f.name, email: f.email, payee: f.payee }, customer: { email: f.customerEmail || undefined }, text: f.text, token: desk?.token }) });
      if (r.confirm) setSent({ email: f.email, demoConfirm: r.demoConfirm });
      else router.push(`/pay/${r.doc.id}`);
    } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  }

  if (sent?.demoConfirm) {
    const u = new URL(sent.demoConfirm);
    return (
      <div className="card pad paybox">
        <b>Confirm your invoice</b>
        <p>This is the demo, so no email goes out. The link below is the one we’d send to <b>{sent.email}</b>. One click and the agents book your invoice. Nothing is booked until you confirm.</p>
        <p><Link href={`${u.pathname}${u.search}`} className="btn primary">Confirm and book the invoice →</Link></p>
      </div>
    );
  }
  if (sent) return (
    <div className="card pad paybox">
      <b>Check your inbox</b>
      <p>We sent a confirmation link to <b>{sent.email}</b>. One click and the agents book your invoice on Arc and email it to your customer. Nothing is booked until you confirm.</p>
      <p className="muted" style={{ fontSize: 13 }}>You’ll also get your private desk link, so next time invoices go out straight away.</p>
    </div>
  );
  return (
    <form className="card pad form" onSubmit={submit}>
      <h3 className="t">Send an invoice <small>money in</small></h3>
      <label className="field">What’s it for?
        <span className="hint">Write it like a WhatsApp message. The Writer turns it into invoice lines; naira is converted to USDC.</span>
        <textarea value={f.text} onChange={set('text')} required minLength={8} style={{ minHeight: 96 }} placeholder="Ada, 2 party trays at ₦25,000 each, due Friday" />
      </label>
      <label className="field">Customer’s email <span className="hint">optional: we email them the invoice and chase it politely</span>
        <input type="email" value={f.customerEmail} onChange={set('customerEmail')} placeholder="ada@gmail.com" />
      </label>
      {desk ? (
        <div className="note">Sending as <b>{desk.name}</b>, paid to <span className="mono">{desk.payee.slice(0, 8)}…{desk.payee.slice(-4)}</span>. <Link href={`/pay/desk/${desk.token}`}>Your desk →</Link></div>
      ) : (
        <>
          <div className="row2" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 12 }}>
            <label className="field">Your business<input type="text" value={f.name} onChange={set('name')} required placeholder="Tolu's Small Chops" /></label>
            <label className="field">Your email<input type="email" value={f.email} onChange={set('email')} required placeholder="you@business.com" /></label>
          </div>
          <label className="field">Where you get paid <span className="hint">your USDC address on Arc. On Bybit: Assets → Deposit → USDC → network <b>Arc</b> → copy. Cash out to naira through P2P any time.</span>
            <input type="text" value={f.payee} onChange={set('payee')} required pattern="^0x[0-9a-fA-F]{40}$" placeholder="0x…" className="mono" />
          </label>
        </>
      )}
      {err && <div className="error">{err}</div>}
      <button className="btn primary block" disabled={busy}>{busy ? 'The Writer is drafting it…' : 'Create the invoice →'}</button>
      <p className="muted" style={{ fontSize: 13 }}>0.5% per paid invoice, taken on-chain. Free to send.</p>
    </form>
  );
}

function DeskSignup() {
  const [desk, setDesk] = useState<DeskInfo | null>(null);
  const [f, setF] = useState({ name: '', email: '', payee: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  useEffect(() => setDesk(readDesk()), []);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await api('/api/pay/business', { method: 'POST', body: JSON.stringify(f) }); setSent(true); } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <div className="card pad form">
      <h3 className="t">Pay bills safely <small>money out</small></h3>
      <ol className="paysteps">
        {[['analyst', 'The Analyst reads the bill', 'a phone photo or screenshot of your supplier’s invoice'], ['investigator', 'The Investigator checks the payee', 'USDC blacklist, a changed payout address, duplicates, unusual amounts'], ['cfo', 'You approve; it’s booked and paid once', 'from your wallet, straight to the supplier']].map(([r, b, s]) => (
          <li key={r}><Avatar role={r} /><div><b>{b}</b><small>{s}</small></div></li>
        ))}
      </ol>
      {desk ? <Link className="btn primary block" href={`/pay/desk/${desk.token}`}>Open your desk: upload a bill →</Link>
        : sent ? <div className="note">Check your inbox: confirm with one click to open your desk.</div>
          : (
            <form className="form" onSubmit={submit} style={{ gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 12 }}>
                <label className="field">Your business<input type="text" value={f.name} onChange={set('name')} required /></label>
                <label className="field">Your email<input type="email" value={f.email} onChange={set('email')} required /></label>
              </div>
              <label className="field">Your Arc address<input type="text" value={f.payee} onChange={set('payee')} required pattern="^0x[0-9a-fA-F]{40}$" placeholder="0x…" className="mono" /></label>
              {err && <div className="error">{err}</div>}
              <button className="btn secondary block" disabled={busy}>{busy ? 'Sending…' : 'Get my desk link'}</button>
            </form>
          )}
    </div>
  );
}

export default function Pay() {
  const { data: cfg } = useApi<{ mode: 'live' | 'demo' | 'off' }>('/api/pay/config');
  return (
    <main className="wrap">
      <div className="pagehead">
        <span className="label"><span className="n">$</span>Syncly Pay</span>
        <h1 className="h1" style={{ marginTop: 14 }}>Get paid. Pay bills safely.</h1>
        <p className="sub">Your invoices and your suppliers’ bills, handled by Syncly’s agents and settled in USDC on Arc. The payee and the amount are fixed on-chain before any money moves, and the money goes straight to whoever you pay. Syncly never holds it.</p>
      </div>
      {cfg?.mode === 'off' && <div className="note" style={{ marginBottom: 18 }}>Syncly Pay is switching on: its contract is being deployed on Arc. You can look around; invoices open in a few minutes.</div>}
      {cfg?.mode === 'demo' && <div className="note" style={{ marginBottom: 18 }}>Demo mode: invoices are booked and paid on a simulated chain.</div>}
      <div className="paygrid">
        <InvoiceForm />
        <DeskSignup />
      </div>
      <section className="payrules">
        <h2 style={{ fontSize: 'clamp(26px,3vw,38px)', letterSpacing: '-0.03em' }}>Rules an agent can’t talk its way past</h2>
        <p className="muted" style={{ marginTop: 8, maxWidth: 680 }}>Every invoice is booked on <a href="https://github.com/neromtoobad/syncly/blob/main/contracts/src/InvoiceBook.sol" target="_blank" rel="noreferrer">InvoiceBook</a>, a contract on Arc. These are the four errors in Canteen’s “Agents and Ledgers” essay, closed by code rather than by a prompt:</p>
        <div className="payrules__grid">
          {GUARANTEES.map(([h, p]) => <div key={h}><b>{h}</b><p>{p}</p></div>)}
        </div>
      </section>
    </main>
  );
}
