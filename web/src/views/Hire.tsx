'use client';
import BringMoney from '@/components/BringMoney.tsx';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, Reveal, Stagger, StaggerItem } from '@/components/motion.tsx';
import { api, useApi, usd, ngn, Avatar, Sprite, Seal, ROLE_NAME, DEPT_TINT, HAS_ART, useStored, type Service, type Quote } from '@/lib.tsx';
import { connect, fundEscrow, hasWallet, short, txUrl, usdcBalance, walletError, type EscrowCfg } from '@/wallet.ts';
import type { Address, Hex } from 'viem';
import BusinessForm, { type Details } from './BusinessForm.tsx';

// Services that take the structured business form instead of a one-line brief.
const FORM_SERVICES = new Set(['website', 'content-pack', 'motion-ad', 'ad-launch', 'product-photos', 'get-found', 'buy-smart']);

// One-line examples for the services ordered in a sentence (the rest use the business form).
const EXAMPLES: Record<string, string[]> = {
  'find-customers': ['I\'m a freelance graphic designer in Abuja. I do logos, flyers and brand kits', 'We supply bottled water in Ikeja and want offices and restaurants that order weekly', 'I do event photography in Port Harcourt and want more corporate clients'],
  'local-business-finder': ['Every café and coffee shop in Lekki Phase 1 that has no website', 'Pharmacies in Yaba, Lagos with a phone number', 'Hair salons in Wuse 2, Abuja rated 4 stars or more'],
  'lead-list': ['25 fitness studios and gyms in Lekki and Ikoyi for my smoothie delivery business', 'Boutique hotels in Victoria Island for our laundry service', 'Private schools in Ikeja for our school-bus app'],
  'research-brief': ['Competitors and pricing for a small bakery in Lekki that wants to add cake delivery', 'Is there demand for solar inverter rentals in Ibadan?', 'How do Lagos co-working spaces price day passes?'],
};

type QuotedOrder = { id: string; status: string; quote: Quote; demo: boolean; brief?: string };


function QuoteDoc({ s, order }: { s: Service; order: QuotedOrder }) {
  const q = order.quote;
  return (
    <motion.div className="quotedoc" initial={{ opacity: 0, y: 40, rotate: -1.5 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ type: 'spring', stiffness: 140, damping: 18 }}>
      <div className="top">
        <div><div className="k">Quote from the CFO</div><div className="id">{order.id}</div></div>
      </div>
      <motion.span className="stamp" initial={{ scale: 2.4, opacity: 0, rotate: -30 }} animate={{ scale: 1, opacity: 0.95, rotate: -12 }} transition={{ delay: 0.55, type: 'spring', stiffness: 420, damping: 16 }}><Seal size={78} /></motion.span>
      <div className="price">{q.promo ? 'Free' : usd(q.priceUsd)}{!q.promo && <small>USDC</small>}</div>
      <div className="ngn">{q.promo ? 'Your first job is on us' : ngn(q.priceUsd)}</div>
      <Stagger className="lines">
        <div className="srow"><span className="lbl">{s.name}</span><span className="fill" /><span className="v">{usd(s.priceUsd)}</span></div>
        {q.promo && <div className="srow"><span className="lbl">First job free</span><span className="fill" /><span className="v">({usd(s.priceUsd)})</span></div>}
        <div className="srow"><span className="lbl">Bond paid to you if you reject<small>{q.promo ? 'n/a on free jobs' : `${Math.round(q.bondBps / 100)}% of price`}</small></span><span className="fill" /><span className="v">{q.promo ? '—' : `+${usd(q.bondUsd)}`}</span></div>
        <div className="srow"><span className="lbl">Delivery</span><span className="fill" /><span className="v">~{s.etaMin} min</span></div>
        <div className="srow total"><span className="lbl">You pay, only if you accept</span><span className="fill" /><span className="v">{q.promo ? '0.00' : usd(q.priceUsd)} USDC</span></div>
      </Stagger>
      <details>
        <summary>Why the CFO priced it this way</summary>
        <ol className="why">{q.reasons.map((r) => <li key={r}>{r}</li>)}</ol>
      </details>
      <div className="signed">
        <Avatar role="cfo" lg />
        <div><motion.div className="sig" initial={{ clipPath: 'inset(0 100% 0 0)' }} animate={{ clipPath: 'inset(0 0% 0 0)' }} transition={{ delay: 0.9, duration: 0.9, ease: 'easeInOut' }}>The CFO</motion.div><div className="muted">Chief Financial Officer, Syncly · {new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</div></div>
      </div>
    </motion.div>
  );
}

type PayPhase = 'idle' | 'connecting' | 'opening' | 'approve' | 'approving' | 'fund' | 'funding' | 'starting';
const PAY_LABEL: Record<PayPhase, string> = {
  idle: '', connecting: 'Connecting your wallet…', opening: 'The CFO is opening your escrow on Arc…', approve: 'Approve in your wallet…',
  approving: 'Waiting for Arc…', fund: 'Confirm the payment in your wallet…', funding: 'Paying into escrow…', starting: 'Paid. Starting the team…',
};

/** Pay in naira through Bachs: bank transfer or a Nigerian card. The naira float on Arc funds the escrow for them. */
function NairaPay({ order }: { order: QuotedOrder }) {
  const [q, setQ] = useState<{ enabled: boolean; ngn?: number; why?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<{ enabled: boolean; ngn?: number; why?: string }>(`/api/orders/${order.id}/naira`).then(setQ).catch(() => setQ({ enabled: false })); }, [order.id]);
  if (!q?.enabled || !q.ngn) return null;
  const ngnText = `₦${q.ngn.toLocaleString('en-NG')}`;
  async function pay() {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ url: string }>(`/api/orders/${order.id}/naira`, { method: 'POST' });
      window.location.href = r.url;
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }
  return (
    <div className="card pad paybox naira">
      <b>Pay {ngnText} by bank transfer or card</b>
      <p style={{ margin: 0, fontSize: 14 }}>No crypto needed. You pay in naira through Bachs, our payment partner, and Syncly puts {usd(order.quote.priceUsd)} USDC into your job's escrow on Arc for you. You decide on the work from the job page; reject it and your naira comes back in full, plus a bond.</p>
      {err && <div className="error">{err}</div>}
      <button className="btn primary lg block" disabled={busy} onClick={pay}>{busy ? 'Opening the payment page…' : `Pay ${ngnText} →`}</button>
      <p className="muted center" style={{ fontSize: 12.5, margin: 0 }}>or pay in USDC from a crypto wallet below</p>
    </div>
  );
}

/** Paid jobs: the customer's own wallet funds a JobEscrow on Arc. Only that wallet can later accept or reject. */
function EscrowPay({ order, cfg, onPaid }: { order: QuotedOrder; cfg: EscrowCfg; onPaid: () => void }) {
  const q = order.quote;
  const [wallet, setWallet] = useState<boolean | null>(null);
  useEffect(() => setWallet(hasWallet()), []);
  const [who, setWho] = useState<Address | null>(null);
  const [openTx, setOpenTx] = useState<string>();
  const [phase, setPhase] = useState<PayPhase>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [bring, setBring] = useState(false);

  async function pay() {
    setErr(null);
    try {
      setPhase('connecting');
      const a = await connect(cfg);
      setWho(a);
      const bal = await usdcBalance(cfg, a);
      if (bal < q.priceUsd) {
        setPhase('idle');
        setErr(`This wallet has ${bal.toFixed(2)} USDC on ${cfg.chainName}. The job needs ${usd(q.priceUsd)} USDC, plus a few cents for gas.`);
        setBring(true);
        return;
      }
      setPhase('opening');
      const o = await api<{ escrow: { id: Hex; openTx: string } }>(`/api/orders/${order.id}/escrow`, { method: 'POST', body: JSON.stringify({ customer: a }) });
      setOpenTx(o.escrow.openTx);
      const tx = await fundEscrow(cfg, a, o.escrow.id, q.priceUsd, setPhase);
      setPhase('starting');
      await api(`/api/orders/${order.id}/sync`, { method: 'POST', body: JSON.stringify({ tx }) });
      onPaid();
    } catch (e: any) {
      setErr(walletError(e));
      setPhase('idle');
    }
  }

  if (wallet === false) return (
    <div className="card pad paybox">
      <b>Pay {usd(q.priceUsd)} USDC from a crypto wallet</b>
      <p>This browser has no wallet. Open this page in your wallet app's browser (MetaMask, Rabby, OKX or Coinbase Wallet) and pay from there. You'll need {usd(q.priceUsd)} USDC on Arc.</p>
      <button className="btn secondary block" onClick={() => { void navigator.clipboard?.writeText(location.href); setCopied(true); }}>{copied ? 'Link copied ✓' : 'Copy the link to this page'}</button>
    </div>
  );

  const at = ['connecting', 'opening', 'approve', 'approving', 'fund', 'funding', 'starting'].indexOf(phase);
  const steps = [
    { label: 'Connect your wallet', sub: who ? short(who) : 'MetaMask, Rabby, OKX, Coinbase Wallet…', done: !!who, now: phase === 'connecting' },
    { label: 'The CFO opens your escrow on Arc', sub: openTx ? <a href={txUrl(cfg, openTx)} target="_blank" rel="noreferrer">opened ↗</a> : `and locks your ${usd(q.bondUsd)} USDC bond`, done: !!openTx, now: phase === 'opening' },
    { label: `Let the escrow take ${usd(q.priceUsd)} USDC`, sub: 'one approval in your wallet', done: at >= 4, now: phase === 'approve' || phase === 'approving' },
    { label: `Pay ${usd(q.priceUsd)} USDC into escrow`, sub: 'the money waits there until you decide', done: phase === 'starting', now: phase === 'fund' || phase === 'funding' },
  ];
  return (
    <div className="card pad paybox">
      <ol className="paysteps">
        {steps.map((s, i) => <li key={i} className={s.done ? 'done' : s.now ? 'now' : ''}><i>{s.done ? '✓' : i + 1}</i><div><b>{s.label}</b><small>{s.sub}</small></div></li>)}
      </ol>
      {err && <div className="error">{err}</div>}
      <button className="btn primary lg block" disabled={phase !== 'idle' || wallet === null} onClick={pay}>{phase === 'idle' ? `Pay ${usd(q.priceUsd)} USDC into escrow →` : PAY_LABEL[phase]}</button>
      <button className="btn ghost block" onClick={() => setBring(true)}>No USDC on Arc? Bring it from another chain →</button>
      <BringMoney cfg={cfg} need={q.priceUsd + 0.05} open={bring} onClose={() => setBring(false)} onArrived={() => setErr(null)} />
      <p className="muted" style={{ fontSize: 13 }}>
        Your USDC goes into a <a href={cfg.explorer ? `${cfg.explorer}/address/${cfg.escrow}` : undefined} target="_blank" rel="noreferrer">contract on {cfg.chainName}</a>, not to us.
        Syncly is paid only when you accept, or after 48 h of silence. Reject it and the contract refunds you, plus the {usd(q.bondUsd)} USDC bond. Gas on Arc is paid in USDC too, a few cents.
      </p>
    </div>
  );
}

export default function Hire({ service }: { service: string }) {
  const router = useRouter();
  const { data } = useApi<{ services: Service[]; mode: string }>('/api/services');
  const { data: esc } = useApi<EscrowCfg | { enabled: false }>('/api/escrow');
  const s = data?.services.find((x) => x.id === service);
  const [brief, setBrief] = useState('');
  const [email, setEmail] = useStored('outlay:email');
  // a brief typed into the home page hero arrives here once
  useEffect(() => { try { const b = sessionStorage.getItem('outlay:brief'); if (b) { setBrief(b); sessionStorage.removeItem('outlay:brief'); } } catch {} }, []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [order, setOrder] = useState<QuotedOrder | null>(null);

  if (data && !s) return <main className="wrap section center"><h1 className="h1">We don't do that one.</h1><p className="lede" style={{ marginTop: 12 }}>Syncly now does 7 things for businesses, and does them properly.</p><p style={{ margin: '14px 0 24px' }}><Link href="/#services" className="btn secondary">See the services</Link></p></main>;
  if (!s) return <main className="wrap section"><div className="skel" style={{ height: 420 }} /></main>;

  async function getQuote(details?: Details) {
    setBusy(true); setErr(null); setOrder(null);
    try {
      localStorage.setItem('outlay:email', email);
      const o = await api<QuotedOrder>('/api/quote', { method: 'POST', body: JSON.stringify({ service, brief: details ? '' : brief, email, details }) });
      if (details && o.brief) setBrief(o.brief);
      setOrder(o);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  const structured = FORM_SERVICES.has(service);
  async function begin(mode: 'promo' | 'simulated') {
    if (!order) return;
    setBusy(true); setErr(null);
    try {
      await api(`/api/orders/${order.id}/start`, { method: 'POST', body: JSON.stringify({ mode }) });
      router.push(`/job/${order.id}`);
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }
  const examples = EXAMPLES[s.id] ?? (s.example ? [s.example] : []);
  const q = order?.quote;
  const others = data!.services.filter((x) => x.live && x.id !== s.id);

  return (
    <main className="wrap">
      <div className="pagehead" style={{ paddingBottom: 0 }}>
        <div className="crumbs"><Link href="/#services">Services</Link><span>/</span><span>{s.dept}</span></div>
      </div>
      <div className="hire">
        <section>
          <h1 className="h1">{s.name}</h1>
          <p style={{ fontSize: 19, color: 'var(--ink-2)', marginTop: 12 }}>{s.tagline}</p>

          <Stagger className="teamphoto" style={{ ['--t' as any]: DEPT_TINT[s.dept] }}>
            {s.team.filter((r) => HAS_ART.has(r)).map((r) => <StaggerItem key={r} style={{ display: 'contents' }} variants={{ hidden: {}, show: {} }}><motion.img className="sprite" src={`/sprites/${r}/${r}-0.png`} alt={r} variants={{ hidden: { opacity: 0, y: 40 }, show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 260, damping: 18 } } }} /></StaggerItem>)}
          </Stagger>
          <div className="names">{s.team.map((r) => <span key={r} className="chip"><Avatar role={r} />{ROLE_NAME[r] ?? r}</span>)}</div>

          <ul className="youget">{s.youGet.map((g) => <li key={g}><i>✓</i>{g}</li>)}</ul>

          <div className="facts">
            <div><div className="k">Price</div><div className="v">{s.priceUsd} USDC<small>{ngn(s.priceUsd)}</small></div></div>
            <div><div className="k">The team</div><div className="v">{s.team.length} agents<small>each pays for its own tools</small></div></div>
            <div><div className="k">Delivered in</div><div className="v">~{s.etaMin} min<small>you watch it happen</small></div></div>
          </div>
          {others.length > 0 && <p className="muted" style={{ fontSize: 14, marginTop: 22 }}>Need something else? {others.map((o, i) => <span key={o.id}>{i ? ' · ' : ''}<Link href={`/hire/${o.id}`}>{o.name}</Link></span>)}</p>}
        </section>

        <section className="sticky">
          {!order || order.status === 'declined' ? (
            structured ? (
            <div className="card pad formcard">
              <h3>Tell us about your business</h3>
              <p className="muted">{service === 'website' ? 'Four short steps. We build from exactly this, your Google listing and your Instagram.' : 'A few short steps. The team works from exactly this, so the result is yours, not generic.'} You'll see the price before anything starts.</p>
              <BusinessForm service={service} onSubmit={(d) => getQuote(d)} busy={busy} email={email} setEmail={setEmail} cta="Get my quote" />
              {err && <div className="error" style={{ marginTop: 14 }}>{err}</div>}
              {order?.status === 'declined' && <div className="error" style={{ marginTop: 14 }}>The CFO declined this job: {order.quote.reasons.at(-1)}</div>}
            </div>
            ) : (
            <div className="card pad formcard">
              <h3>{service === 'find-customers' ? 'What do you sell, and where?' : 'Tell the team what you need'}</h3>
              <p className="muted">{service === 'find-customers' ? "Say what you offer and where you work. If you already know who you want (e.g. hotels, schools), say so; if not, the team works it out. You'll see the exact price before anything starts." : "One or two sentences is enough. You'll see the exact price before anything starts."}</p>
              <div className="form">
                <label className="field">{service === 'find-customers' ? 'What you sell' : 'The job'}
                  <textarea value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={examples[0] ?? 'Describe the job'} autoFocus={!brief} />
                </label>
                {examples.length > 0 && <div className="examples">{examples.map((x) => <button type="button" key={x} className="chip click" onClick={() => setBrief(x)}>{x}</button>)}</div>}
                <label className="field">Your email <span className="hint">It's your key to this job: you confirm with it to accept, revise or reject.</span>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" />
                </label>
                {err && <div className="error">{err}</div>}
                {order?.status === 'declined' && <div className="error">The CFO declined this job: it can't be done well at this price. {order.quote.reasons.at(-1)}</div>}
                <button className="btn primary lg block" disabled={busy || brief.trim().length < 12 || !email.includes('@')} onClick={() => getQuote()}>{busy ? 'The CFO is pricing it…' : 'Get my quote'}</button>
                <p className="muted center" style={{ fontSize: 13 }}>You see the price first · no card · refund + bond if you reject</p>
              </div>
            </div>
            )
          ) : (
            <div className="form">
              <QuoteDoc s={s} order={order} />
              <div className="note" style={{ whiteSpace: 'pre-line' }}><b>Your brief:</b> {brief}</div>
              {err && <div className="error">{err}</div>}
              {q!.promo ? (
                <button className="btn primary lg block" disabled={busy} onClick={() => begin('promo')}>Start my free job →</button>
              ) : esc?.enabled ? (
                <>
                  <NairaPay order={order} />
                  <EscrowPay order={order} cfg={esc} onPaid={() => router.push(`/job/${order.id}`)} />
                </>
              ) : data?.mode === 'demo' ? (
                <>
                  <button className="btn primary lg block" disabled={busy} onClick={() => begin('simulated')}>Pay {usd(q!.priceUsd)} USDC into escrow (demo)</button>
                  <p className="muted center" style={{ fontSize: 13 }}>Demo mode simulates the escrow payment. On the live site this funds the job's escrow on Arc.</p>
                </>
              ) : (
                <p className="note">Paid jobs through escrow on Arc are being switched on. Check back in a few minutes.</p>
              )}
              <button className="btn ghost sm" style={{ justifySelf: 'center' }} onClick={() => setOrder(null)}>Change the brief</button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
