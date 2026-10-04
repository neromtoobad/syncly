'use client';
// One invoice or bill, payable once, to the payee fixed on Arc. The payer's wallet signs; the server only reads the chain.
import BringMoney from '@/components/BringMoney.tsx';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Address, Hex } from 'viem';
import { api, useApi, ngn } from '@/lib.tsx';
import { connect, hasWallet, payInvoiceOnChain, short, txUrl, walletError, type EscrowCfg } from '@/wallet.ts';

type Line = { what: string; qty: number; unitUsd: number };
export type PayDocView = {
  id: string; key: Hex; kind: 'invoice' | 'bill'; seller: { name: string; email?: string }; buyer: { name: string; email?: string };
  payee: Address; amountUsd: number; lines: Line[]; due?: string; note?: string; ref?: string; doc: string; docHash: string; feeBps: number;
  status: 'confirm-email' | 'checking' | 'review' | 'booking' | 'open' | 'paid' | 'cancelled' | 'failed';
  checks?: { level: 'ok' | 'warn' | 'stop'; text: string; override?: string }[];
  bookTx?: string; payTx?: string; payer?: string; paidAt?: string; feeUsd?: number; createdAt: string; error?: string; book: Address | null; mode: 'live' | 'demo' | 'off';
};
export const STATUS_LABEL: Record<PayDocView['status'], string> = { 'confirm-email': 'Waiting for the business to confirm', checking: 'The agents are checking it', review: 'Waiting for approval', booking: 'Booking on Arc…', open: 'Unpaid', paid: 'Paid', cancelled: 'Cancelled', failed: 'Failed' };
const f2 = (n: number) => n.toFixed(2);
const real = (tx?: string) => !!tx && !tx.startsWith('demo');

type Phase = 'idle' | 'connecting' | 'approve' | 'approving' | 'pay' | 'paying' | 'confirming';
const PHASE: Record<Phase, string> = { idle: '', connecting: 'Connecting your wallet…', approve: 'Approve in your wallet…', approving: 'Waiting for Arc…', pay: 'Confirm the payment in your wallet…', paying: 'Paying on Arc…', confirming: 'Paid. Updating the receipt…' };

function PayBox({ d, onPaid }: { d: PayDocView; onPaid: (d: PayDocView) => void }) {
  const { data: esc } = useApi<EscrowCfg | { enabled: false }>('/api/escrow');
  const cfg = esc && esc.enabled ? esc : null;
  const [wallet, setWallet] = useState<boolean | null>(null);
  useEffect(() => setWallet(hasWallet()), []);
  const [phase, setPhase] = useState<Phase>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [bring, setBring] = useState(false);

  async function pay() {
    setErr(null);
    try {
      if (d.mode === 'demo') { setPhase('confirming'); onPaid(await api<PayDocView>(`/api/pay/invoices/${d.id}/sync`, { method: 'POST', body: JSON.stringify({ demoPayer: '0x' + 'ab'.repeat(20) }) })); return; }
      if (!cfg || !d.book) throw new Error('Payments are not switched on yet.');
      setPhase('connecting');
      const who = await connect(cfg);
      const tx = await payInvoiceOnChain(cfg, who, d.book, d.key, d.amountUsd, setPhase);
      setPhase('confirming');
      onPaid(await api<PayDocView>(`/api/pay/invoices/${d.id}/sync`, { method: 'POST', body: JSON.stringify({ tx }) }));
    } catch (x: any) { setErr(walletError(x)); setPhase('idle'); }
  }

  return (
    <div className="card pad paybox">
      <b>Pay {f2(d.amountUsd)} USDC</b>
      <p>Straight from your wallet to {d.seller.name}, in one payment on Arc. You approve exactly this amount; the contract sends it to <span className="mono">{short(d.payee)}</span> and nowhere else, and it can’t be paid twice.</p>
      {d.mode === 'demo' ? <div className="note">Demo mode: this simulates the payment, no money moves.</div>
        : wallet === false ? <div className="note">Open this page in your wallet app’s browser (OKX, MetaMask, Rabby, Coinbase Wallet) to pay. You need {f2(d.amountUsd)} USDC on Arc plus a few cents for gas.</div> : null}
      {err && <div className="error">{err}</div>}
      <button className="btn primary lg block" disabled={phase !== 'idle' || (d.mode !== 'demo' && wallet === false)} onClick={pay}>{phase === 'idle' ? `Pay ${f2(d.amountUsd)} USDC →` : PHASE[phase]}</button>
      {d.mode !== 'demo' && cfg && <button className="btn ghost block" onClick={() => setBring(true)}>No USDC on Arc? Bring it from another chain, swap, or buy with naira →</button>}
      {cfg && <BringMoney cfg={cfg} need={d.amountUsd + 0.05} open={bring} onClose={() => setBring(false)} />}
    </div>
  );
}

export function Proof({ d }: { d: PayDocView }) {
  const arc = (tx?: string, label?: string) => (real(tx) ? <a href={`https://explorer.arc.io/tx/${tx}`} target="_blank" rel="noreferrer">{label} ↗</a> : tx ? <span className="muted">{label} (demo)</span> : null);
  return (
    <section className="card pad">
      <h3 className="t">Fixed on Arc</h3>
      <div className="payee-full"><span className="lbl">Pays only this address</span><span className="mono">{d.payee}</span></div>
      <div className="srow"><span className="lbl">Amount</span><span className="fill" /><span className="v">{f2(d.amountUsd)} USDC</span></div>
      <div className="srow"><span className="lbl">Fee</span><span className="fill" /><span className="v">{(d.feeBps / 100).toFixed(1)}%, from the payee’s side</span></div>
      <div className="txlinks" style={{ marginTop: 8 }}>{arc(d.bookTx, 'Booked')}{arc(d.payTx, 'Paid')}</div>
      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>The invoice document sealed on-chain</summary>
        <p className="muted" style={{ fontSize: 12.5, margin: '8px 0 6px' }}>keccak256 of this text is the invoice’s docHash: <span className="mono" style={{ wordBreak: 'break-all' }}>{d.docHash}</span></p>
        <pre className="spec">{d.doc}</pre>
      </details>
    </section>
  );
}

export default function PayInvoice({ id }: { id: string }) {
  const [d, setD] = useState<PayDocView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => api<PayDocView>(`/api/pay/invoices/${id}`).then((x) => live && setD(x)).catch((e) => live && setErr(e.message));
    load();
    const t = setInterval(load, 6000);
    return () => { live = false; clearInterval(t); };
  }, [id]);

  if (err && !d) return <main className="wrap section center"><h1 className="h1">Couldn’t find this invoice.</h1><p className="muted" style={{ margin: '12px 0 24px' }}>{err}</p><Link href="/pay" className="btn secondary">Syncly Pay</Link></main>;
  if (!d) return <main className="wrap section"><div className="skel" style={{ height: 420 }} /></main>;
  const isBill = d.kind === 'bill';
  return (
    <main className="wrap">
      <div className="pagehead" style={{ paddingBottom: 18 }}>
        <div className="crumbs"><Link href="/pay">Syncly Pay</Link><span>/</span><span className="mono" style={{ fontSize: 13 }}>{d.ref ?? d.id}</span></div>
        <div className="jobhead">
          <div>
            <h1 className="h1">{isBill ? `Bill from ${d.seller.name}` : `Invoice from ${d.seller.name}`}</h1>
            <div className="meta">{isBill ? `for ${d.buyer.name}` : `to ${d.buyer.name}`}{d.due ? ` · due ${d.due}` : ''} · {new Date(d.createdAt).toLocaleDateString()}</div>
          </div>
          <span className={`badge ${d.status === 'paid' ? 'accepted' : d.status === 'open' ? 'delivered' : d.status === 'failed' || d.status === 'cancelled' ? 'failed' : 'running'}`}><span className="dot" />{STATUS_LABEL[d.status]}</span>
        </div>
      </div>
      <div className="jobgrid">
        <div style={{ display: 'grid', gap: 20, minWidth: 0 }}>
          <section className="card pad">
            <table className="invlines">
              <thead><tr><th>Item</th><th>Qty</th><th>Each</th><th>USDC</th></tr></thead>
              <tbody>{d.lines.map((l, i) => <tr key={i}><td>{l.what}</td><td>{l.qty}</td><td>{f2(l.unitUsd)}</td><td>{f2(l.qty * l.unitUsd)}</td></tr>)}</tbody>
              <tfoot><tr><td colSpan={3}>Total</td><td>{f2(d.amountUsd)} <small className="muted">{ngn(d.amountUsd)}</small></td></tr></tfoot>
            </table>
            {d.note && <p className="muted" style={{ marginTop: 14, fontSize: 14 }}>{d.note}</p>}
          </section>
          <Proof d={d} />
        </div>
        <aside>
          {d.status === 'open' ? <PayBox d={d} onPaid={setD} />
            : d.status === 'paid' ? (
              <div className="card pad paybox">
                <b>Paid · thank you</b>
                <p>{f2(d.amountUsd)} USDC paid {d.paidAt ? `on ${new Date(d.paidAt).toLocaleString()}` : ''}{d.payer ? ` from ${short(d.payer)}` : ''}. {d.seller.name} received {f2(d.amountUsd - (d.feeUsd ?? 0))} USDC after the {(d.feeBps / 100).toFixed(1)}% fee.</p>
                {real(d.payTx) && <a className="btn secondary block" href={`https://explorer.arc.io/tx/${d.payTx}`} target="_blank" rel="noreferrer">See the payment on Arc ↗</a>}
              </div>
            ) : (
              <div className="card pad paybox"><b>{STATUS_LABEL[d.status]}</b><p>{d.status === 'confirm-email' ? `${d.seller.name} has to confirm this invoice by email before it can be paid.` : d.status === 'review' ? 'The business is reviewing the agents’ checks before this bill is booked.' : d.status === 'checking' ? 'The Analyst is reading the bill and the Investigator is checking the payee.' : d.error ?? 'This invoice can’t be paid.'}</p></div>
            )}
          <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>Invoices on <Link href="/pay">Syncly Pay</Link> are booked on Arc by Syncly’s agents. The money never passes through Syncly.</p>
        </aside>
      </div>
    </main>
  );
}
