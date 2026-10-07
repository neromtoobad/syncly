'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { api, useApi, usd, timeAgo, SERVICE_NAME, Avatar, OWNER_KEY } from '@/lib.tsx';
import { CountUp, Reveal } from '@/components/motion.tsx';
import CfoDesk from './CfoDesk.tsx';

type Entry = { date: string; narration: string; postings: { account: string; amount: number }[]; meta: { doc?: string; tx?: string; agent?: string; reason?: string; kind: string; settled?: boolean } };
type Books = {
  mode: 'demo' | 'live'; asOf: string;
  counters: { orders: number; quotes: number; customers: number; delivered: number; accepted: number; rejected: number; acceptanceRate: number | null; freeJobs: number; toolCalls: number };
  pnl: { revenue: number; tools: number; experts: number; guarantee: number; grossMargin: number; byVendor: Record<string, number>; byService: Record<string, number>; bondsPaid: number; refunds: number };
  perService: Record<string, { jobs: number; avgCost: number; price: number; accepted: number; decided: number; free: number }>;
  daily: { date: string; revenue: number; costs: number }[];
  vault: null | { vault: string; escrow: string; explorer: string | null; buckets: Record<string, number>; bondsOutstanding: number; reserveFloor: number };
  ledger: Entry[];
};

const BUCKETS: [string, string, string][] = [
  ['operating', 'Operating', 'Paid-in revenue and owner funding'],
  ['tools', 'Tool budgets', 'Waiting to be topped up into agents’ Gateway balances'],
  ['bond', 'Bond pool', 'Backs every guarantee we have quoted'],
  ['reserve', 'Reserve', 'Runway the CFO may not touch below the floor'],
  ['promo', 'Promo', 'Pays for free first jobs, capped per epoch'],
];
const REV = '#1c7d5c', COST = '#b37a16'; // validated pair: CVD ΔE 9.0, both ≥ 3:1 on the card surface

function Bars({ rows, gold }: { rows: { label: string; value: number; note?: string }[]; gold?: boolean }) {
  const [tip, setTip] = useState<{ x: number; y: number; t: string } | null>(null);
  const max = Math.max(1e-9, ...rows.map((r) => r.value));
  return (
    <div className="bars" onMouseLeave={() => setTip(null)}>
      {rows.map((r) => (
        <div key={r.label} className="bar" onMouseMove={(e) => setTip({ x: e.clientX + 12, y: e.clientY + 12, t: `${r.label}: ${usd(r.value, 4)} USDC${r.note ? ` · ${r.note}` : ''}` })}>
          <span>{r.label}</span>
          <span className="track"><span className={`fill${gold ? ' gold' : ''}`} style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <span className="num">{usd(r.value, r.value < 1 ? 4 : 2)}</span>
        </div>
      ))}
      {tip && <div className="tip" style={{ left: tip.x, top: tip.y }}>{tip.t}</div>}
    </div>
  );
}

/** Revenue vs costs per day, last 14 days, grouped bars on one axis. */
function Daily({ daily }: { daily: Books['daily'] }) {
  const [tip, setTip] = useState<{ x: number; y: number; t: string } | null>(null);
  const days: { date: string; revenue: number; costs: number }[] = [];
  const by = Object.fromEntries(daily.map((d) => [d.date, d]));
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    days.push(by[d] ?? { date: d, revenue: 0, costs: 0 });
  }
  const W = 560, H = 200, L = 34, B = 24, T = 10;
  const max = Math.max(1, ...days.map((d) => Math.max(d.revenue, d.costs)));
  const nice = Math.ceil(max);
  const step = (W - L) / days.length, bw = Math.min(12, step / 2 - 3);
  const y = (v: number) => T + (H - T - B) * (1 - v / nice);
  const bar = (x: number, v: number, c: string) => v > 0 && <path d={`M${x},${y(0)} V${y(v) + 4} a4,4 0 0 1 4,-4 h${bw - 8} a4,4 0 0 1 4,4 V${y(0)} Z`} fill={c} />;
  return (
    <div style={{ position: 'relative' }} onMouseLeave={() => setTip(null)}>
      <div className="legend"><span><i style={{ background: REV }} />Revenue</span><span><i style={{ background: COST }} />Costs (tools, bonds, experts)</span></div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Revenue and costs per day, last 14 days">
        {[0, 0.5, 1].map((f) => <g key={f}><line x1={L} x2={W} y1={y(nice * f)} y2={y(nice * f)} stroke="var(--line)" /><text x={L - 6} y={y(nice * f) + 4} textAnchor="end">{(nice * f).toFixed(nice * f % 1 ? 1 : 0)}</text></g>)}
        {days.map((d, i) => {
          const x = L + i * step + step / 2;
          return (
            <g key={d.date} onMouseMove={(e) => setTip({ x: e.clientX + 12, y: e.clientY + 12, t: `${d.date} · revenue ${usd(d.revenue)} · costs ${usd(d.costs, 3)} USDC` })}>
              <rect x={x - step / 2} y={T} width={step} height={H - T - B} fill="transparent" />
              {bar(x - bw - 1, d.revenue, REV)}
              {bar(x + 1, d.costs, COST)}
              {(i % 3 === 1 || i === days.length - 1) && <text x={x} y={H - 6} textAnchor="middle">{d.date.slice(5)}</text>}
            </g>
          );
        })}
      </svg>
      {tip && <div className="tip" style={{ left: tip.x, top: tip.y }}>{tip.t}</div>}
    </div>
  );
}

/** The books are private: the owner's passcode (OUTLAY_OWNER_KEY in Railway) opens them on this device. */
function OwnerGate() {
  const [key, setKey] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function open(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await api('/api/owner', { headers: { 'x-owner-key': key.trim() } });
      localStorage.setItem(OWNER_KEY, key.trim());
      window.location.reload();
    } catch (x: any) { setErr(x.message); setBusy(false); }
  }
  return (
    <main className="wrap section center">
      <div className="eyebrow">Your books</div>
      <h1 className="h1">The books are private.</h1>
      <p className="muted" style={{ margin: '12px 0 24px' }}>Enter your owner passcode to open them on this device.</p>
      <form className="form" style={{ maxWidth: 380, margin: '0 auto' }} onSubmit={open}>
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Owner passcode" autoFocus aria-label="Owner passcode" />
        <button className="btn primary block" disabled={busy || key.trim().length < 8}>{busy ? 'Checking…' : 'Open the books'}</button>
        {err && <div className="error">{err}</div>}
      </form>
    </main>
  );
}

/** Owner tool: send a test email the way deliveries go out, to check the mail setup end to end. */
function TestEmail() {
  const [to, setTo] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function send(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try { await api('/api/owner/test-email', { method: 'POST', body: JSON.stringify({ to }) }); setMsg(`Sent. Check ${to} (and the spam folder).`); }
    catch (x: any) { setMsg(x.message); } finally { setBusy(false); }
  }
  return (
    <form className="testmail" onSubmit={send}>
      <span className="mono">Email check</span>
      <input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@gmail.com" aria-label="Send a test email to" />
      <button className="btn secondary sm" disabled={busy || !to.includes('@')}>{busy ? 'Sending…' : 'Send a test email'}</button>
      {msg && <span className="muted">{msg}</span>}
    </form>
  );
}

/** Owner tool: a free redo of an order, on the house (same brief, details, photos and email). Opens the new job. */
function RedoOnTheHouse() {
  const [id, setId] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try { const o = await api<{ id: string }>(`/api/orders/${encodeURIComponent(id.trim())}/redo`, { method: 'POST' }); window.location.href = `/job/${o.id}`; }
    catch (x: any) { setMsg(x.message); setBusy(false); }
  }
  return (
    <form className="testmail" onSubmit={go}>
      <span className="mono">Redo on the house</span>
      <input value={id} onChange={(e) => setId(e.target.value)} placeholder="ord_…" aria-label="Order ID to redo for free" />
      <button className="btn secondary sm" disabled={busy || !/^ord_[a-z0-9_]+$/i.test(id.trim())}>{busy ? 'Starting…' : 'Redo it free'}</button>
      {msg && <span className="muted">{msg}</span>}
    </form>
  );
}

export default function Books() {
  const { data: b, error } = useApi<Books>('/api/books', 10000);
  if (error && /owner only|401/i.test(error)) return <OwnerGate />;
  if (error) return <main className="wrap section center"><h1 className="h1">The books are closed for a moment.</h1><p className="muted" style={{ marginTop: 12 }}>{error}</p></main>;
  if (!b) return <main className="wrap section"><div className="skel" style={{ height: 520 }} /></main>;
  const c = b.counters, p = b.pnl;
  const vendors = Object.entries(p.byVendor).sort((a, z) => z[1] - a[1]).map(([label, value]) => ({ label, value }));

  return (
    <main className="wrap" style={{ paddingBottom: 96 }}>
      <div className="pagehead">
        <div className="eyebrow">Your books · private</div>
        <h1 className="h1">Every dollar Syncly <em>makes and spends.</em></h1>
        <p className="sub">Only you can see this page. An AI CFO runs Syncly's money, and these books come from the same records that move it: job receipts, escrow and the vault on Arc. Updated {timeAgo(b.asOf)}. <button type="button" className="linkbtn" onClick={() => { try { localStorage.removeItem(OWNER_KEY); } catch {} window.location.reload(); }}>Lock this device</button></p>
        <TestEmail />
      <RedoOnTheHouse />
        {b.mode === 'demo' && <div className="banner"><span>●</span><div><b>Demo mode.</b> These numbers come from simulated jobs: no real money moved and every receipt is marked “demo”. Live figures from Arc mainnet replace them when the treasury is funded.</div></div>}
      </div>

      <Reveal className="kpirow">
        <div><div className="k">Revenue</div><div className="v"><CountUp value={p.revenue} decimals={2} /><small>USDC</small></div><div className="d">accepted, paid jobs only</div></div>
        <div><div className="k">Tool spend on Arc</div><div className="v"><CountUp value={p.tools} decimals={3} /><small>USDC</small></div><div className="d">{c.toolCalls} x402 payments</div></div>
        <div><div className="k">Gross margin</div><div className={`v${p.grossMargin < 0 ? ' neg' : ''}`}><CountUp value={p.grossMargin} decimals={2} /><small>USDC</small></div><div className="d">{p.revenue ? `${Math.round((p.grossMargin / p.revenue) * 100)}% of revenue` : 'no revenue yet'}</div></div>
        <div><div className="k">Acceptance</div><div className="v"><CountUp value={c.acceptanceRate == null ? null : Math.round(c.acceptanceRate * 100)} suffix="%" /></div><div className="d">{c.accepted} accepted · {c.rejected} rejected</div></div>
      </Reveal>
      <div className="minis">
        <div><b>{c.delivered}</b>jobs delivered</div>
        <div><b>{c.customers}</b>customers · {c.freeJobs} free jobs</div>
        <div><b>{usd(p.refunds + p.bondsPaid)}</b>refunds + bonds paid</div>
        <div><b>{usd(p.experts)}</b>paid to human reviewers</div>
      </div>

      <div className="row2" style={{ marginTop: 20 }}>
        <div className="statement">
          <div className="head"><div><h4>Income statement</h4><div className="muted">To date · USDC</div></div></div>
          <div className="srow"><span className="lbl">Revenue<small>accepted, paid jobs</small></span><span className="fill" /><span className="v">{usd(p.revenue)}</span></div>
          {Object.entries(p.byService ?? {}).map(([k, v]) => <div key={k} className="srow sub"><span className="lbl">{k.replace(/([a-z])([A-Z])/g, '$1 $2')}</span><span className="fill" /><span className="v">{usd(v)}</span></div>)}
          <div className="srow neg"><span className="lbl">Tools bought by agents<small>{c.toolCalls} payments</small></span><span className="fill" /><span className="v">({usd(p.tools, 3)})</span></div>
          <div className="srow neg"><span className="lbl">Bonds paid to customers</span><span className="fill" /><span className="v">({usd(p.guarantee)})</span></div>
          <div className="srow neg"><span className="lbl">Human expert reviews</span><span className="fill" /><span className="v">({usd(p.experts)})</span></div>
          <div className="srow total"><span className="lbl">Gross margin</span><span className="fill" /><span className="v">{usd(p.grossMargin, 3)}</span></div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>Refunds ({usd(p.refunds)}) return customers' own escrowed money, so they are not a cost. The bond on top is.</p>
        </div>
        <section className="card pad">
          <h3 className="t">Revenue and costs <small>per day, last 14 days</small></h3>
          <Daily daily={b.daily} />
        </section>
      </div>

      <div className="row2" style={{ marginTop: 20 }}>
        <section className="card pad">
          <h3 className="t">Where the money sits <small>SynclyVault on Arc</small></h3>
          {b.vault ? (
            <>
              <Bars rows={BUCKETS.map(([k, label, note]) => ({ label, value: b.vault!.buckets[k] ?? 0, note }))} />
              <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>Bonds outstanding {usd(b.vault.bondsOutstanding)} USDC (the bond pool must always cover them) · reserve floor {usd(b.vault.reserveFloor)} USDC · {b.vault.explorer ? <><a href={`${b.vault.explorer}/address/${b.vault.vault}`} target="_blank" rel="noreferrer">vault ↗</a> · <a href={`${b.vault.explorer}/address/${b.vault.escrow}`} target="_blank" rel="noreferrer">job escrow ↗</a></> : <>vault <span className="mono">{b.vault.vault.slice(0, 10)}…</span></>}</p>
            </>
          ) : (
            <>
              <p className="muted" style={{ fontSize: 14 }}>The vault isn't on mainnet yet. Once deployed, this reads its five buckets live from the chain. The policy it enforces:</p>
              <ul className="rules" style={{ marginTop: 12, fontSize: 14.5 }}>
                {BUCKETS.map(([k, label, note]) => <li key={k}><b>{label}</b>: {note}</li>)}
                <li>The CFO can move money <b>between</b> buckets but can't send it anywhere else. Moves over 2 USDC need the owner's signature.</li>
              </ul>
            </>
          )}
        </section>
        <section className="card pad">
          <h3 className="t">Tool spend by vendor <small>paid per call via x402</small></h3>
          {vendors.length ? <Bars rows={vendors} gold /> : <p className="muted">No purchases yet.</p>}
        </section>
      </div>

      <CfoDesk />

      <section className="card pad" style={{ marginTop: 20 }}>
        <h3 className="t">Unit economics <small>per service, measured, not estimated</small></h3>
        <div className="tblwrap">
          <table className="tbl">
            <thead><tr><th>Service</th><th className="num">Jobs</th><th className="num">List price</th><th className="num">Avg tool cost</th><th className="num">Margin / job</th><th className="num">Accepted</th></tr></thead>
            <tbody>
              {Object.entries(b.perService).map(([k, s]) => (
                <tr key={k}>
                  <td><Link href={`/hire/${k}`}>{SERVICE_NAME[k] ?? k}</Link></td>
                  <td className="num">{s.jobs}{s.free ? <span className="muted"> ({s.free} free)</span> : null}</td>
                  <td className="num">{usd(s.price)}</td>
                  <td className="num">{usd(s.avgCost, 4)}</td>
                  <td className="num">{usd(s.price - s.avgCost, 3)}</td>
                  <td className="num">{s.decided ? `${s.accepted}/${s.decided}` : '—'}</td>
                </tr>
              ))}
              {!Object.keys(b.perService).length && <tr><td colSpan={6} className="muted">No jobs yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card pad" style={{ marginTop: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h3 className="t">The ledger <small>double-entry, every line linked to its job and payment</small></h3>
          <a className="btn secondary sm" href="/api/books.beancount">↓ Download beancount file</a>
        </div>
        <div className="tblwrap">
          <table className="tbl">
            <thead><tr><th>Date</th><th>What happened</th><th>Accounts</th><th className="num">USDC</th><th>Job / payment</th></tr></thead>
            <tbody>
              {b.ledger.slice(0, 60).map((e, i) => {
                const debit = e.postings.filter((x) => x.amount > 0);
                return (
                  <tr key={i}>
                    <td className="mono" style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{e.date}</td>
                    <td><span style={{ display: 'inline-flex', gap: 8, alignItems: 'flex-start' }}>{e.meta.agent && <Avatar role={e.meta.agent} />}<span>{e.narration}{e.meta.reason && <div className="ref">{e.meta.reason}</div>}</span></span></td>
                    <td className="ref">{e.postings.map((x) => <div key={x.account} className={x.amount > 0 ? 'dr' : 'cr'}>{x.amount > 0 ? 'Dr' : 'Cr'} {x.account}</div>)}</td>
                    <td className="num">{usd(debit.reduce((s, x) => s + x.amount, 0), 4)}</td>
                    <td className="ref">{e.meta.doc ? <Link href={`/job/${e.meta.doc}`}>{e.meta.doc}</Link> : '—'}<div>{e.meta.tx === 'dry-run' ? 'demo' : e.meta.settled ? <a href={`https://explorer.arc.io/tx/${e.meta.tx}`} target="_blank" rel="noreferrer">{e.meta.tx?.slice(0, 10)}… ↗</a> : 'settling…'}</div></td>
                  </tr>
                );
              })}
              {!b.ledger.length && <tr><td colSpan={5} className="muted">No entries yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card pad" style={{ marginTop: 20 }}>
        <h3 className="t">How we count</h3>
        <ul className="rules">
          <li><b>Revenue</b> is only paid jobs the customer accepted, or that auto-accepted after 48 h of silence. Free first jobs are never revenue.</li>
          <li><b>Tool spend</b> is every x402 payment our agents made, each linked to the job and the reason it was bought.</li>
          <li><b>Bonds</b> count as costs on the day they're paid.</li>
          <li><b>Demo data and live data are never mixed.</b> In demo mode nothing here is real money, and it says so.</li>
          <li>Money we move to ourselves (treasury → agent budgets) is never counted as “value moved”.</li>
        </ul>
      </section>
    </main>
  );
}
