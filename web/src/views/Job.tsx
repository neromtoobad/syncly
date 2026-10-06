'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { api, useApi, usd, ngn, Avatar, ROLE_NAME, SERVICE_NAME, timeAgo, useStored, type Order, type Receipt, type Service, type Step } from '@/lib.tsx';
import { connect, decideOnChain, hasWallet, short, txUrl, walletError, type EscrowCfg } from '@/wallet.ts';
import type { Address } from 'viem';
import type { ReactNode } from 'react';
import Office from '@/office/Office.tsx';
import type { OfficeEvent } from '@/office/scene.ts';
import { useRouter } from 'next/navigation';
import { saveBusiness } from './BusinessForm.tsx';
import { AnimatePresence, motion } from 'motion/react';

function Stepper({ o }: { o: Order }) {
  const st = o.status;
  const working = ['queued', 'running', 'revision'].includes(st);
  const steps: { label: string; note: string; cls: string }[] = [
    { label: 'Ordered', note: o.payment ? (o.payment.mode === 'promo' ? 'Free first job' : o.payment.mode === 'simulated' ? 'Paid (demo)' : o.naira ? 'Paid in naira' : 'Paid into escrow') : o.naira?.status === 'open' ? 'Awaiting naira' : 'Quoted', cls: 'done' },
    { label: st === 'revision' || (working && o.revisionNote) ? 'Revising' : 'Team working', note: working ? 'Live now' : `${o.runs.length} run${o.runs.length === 1 ? '' : 's'}`, cls: working ? 'now' : 'done' },
    { label: st === 'failed' ? 'Not delivered' : 'Delivered', note: o.deliveredAt ? timeAgo(o.deliveredAt) : st === 'failed' ? 'Refund + bond' : 'Soon', cls: st === 'failed' ? 'bad' : o.deliveredAt ? 'done' : '' },
    {
      label: st === 'accepted' ? 'Accepted' : st === 'rejected' ? 'Rejected' : 'Your decision',
      note: st === 'accepted' ? (o.decision?.by === 'auto' ? 'Auto after 48 h' : 'By you') : st === 'rejected' ? 'Refund + bond paid' : st === 'delivered' ? 'Waiting on you' : '48 h to decide',
      cls: st === 'accepted' ? 'done' : st === 'rejected' ? 'bad' : st === 'delivered' ? 'now' : '',
    },
  ];
  return <div className="stepper">{steps.map((s, i) => <motion.div key={s.label} className={`s ${s.cls}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.08 }}><b>{s.label}</b><span>{s.note}</span></motion.div>)}</div>;
}

function Timeline({ steps }: { steps: Step[] }) {
  return (
    <ul className="timeline">
      {steps.length === 0 && <li><Avatar role="cfo" /><span>The CFO is staffing the job…</span><time /></li>}
      <AnimatePresence initial={false}>
      {steps.map((s, i) => (
        <motion.li key={`${s.at}${i}`} initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35 }}><Avatar role={s.agent} /><div><b>{ROLE_NAME[s.agent] ?? s.agent}</b><span>{s.step}{s.note ? ` · ${s.note}` : ''}</span></div><time>{new Date(s.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></motion.li>
      ))}
      </AnimatePresence>
    </ul>
  );
}

/** Every call the team made for this job, each linked to its settlement on Arc. Costs show only to the owner. */
/** One tap to another service for the same business: its details become this device's form draft. */
function MoreFor({ o }: { o: Order }) {
  const router = useRouter();
  const { data } = useApi<{ services: Service[] }>('/api/services');
  const next = (data?.services ?? []).filter((s) => s.live && s.id !== o.service && !['local-business-finder', 'lead-list', 'research-brief'].includes(s.id));
  if (!next.length) return null;
  return (
    <div style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
      <b style={{ fontSize: 14.5 }}>More for {String(o.details!.name)}</b>
      <p className="muted" style={{ fontSize: 13, margin: '2px 0 0' }}>Your details are filled in already.</p>
      <div className="morefor">
        {next.map((s) => <button key={s.id} type="button" className="chip click" onClick={() => { saveBusiness(o.details!); router.push(`/hire/${s.id}`); }}>{s.name} · {s.priceUsd} USDC</button>)}
      </div>
    </div>
  );
}

function PaperReceipt({ o, receipt }: { o: Order; receipt: Receipt[] }) {
  const q = o.quote;
  const owner = receipt.some((r) => typeof r.usd === 'number');
  const spent = receipt.reduce((s, r) => s + (r.usd ?? 0), 0);
  const price = q.promo || o.refund ? 0 : q.priceUsd; // a refunded job earned nothing
  const bond = o.refund?.bondUsd ?? 0;
  return (
    <div className="receipt">
      <div className="rh"><b>SYNCLY</b><span>{o.id} · {new Date(o.createdAt).toLocaleDateString()}</span></div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', textAlign: 'center' }}>Every tool the team paid for on this job</div>
      <hr />
      <div className="scroll">
        {receipt.length === 0 && <div className="empty">Nothing bought yet</div>}
        {receipt.map((r, i) => (
          <motion.div key={i} className="ln" initial={{ opacity: 0, y: -6, clipPath: 'inset(0 0 100% 0)' }} animate={{ opacity: 1, y: 0, clipPath: 'inset(0 0 0% 0)' }} transition={{ delay: Math.min(i, 12) * 0.05, duration: 0.3 }}>
            <span className="who"><Avatar role={r.agent} />{r.vendor}</span>
            {owner && <span className="v">{r.usd!.toFixed(4)}</span>}
            <span className="why">{r.reason}{r.dry ? ' · demo' : r.settledTx ? <> · <a href={`https://explorer.arc.io/tx/${r.settledTx}`} target="_blank" rel="noreferrer">settled on Arc ↗</a></> : ' · paid, settling on Arc…'}</span>
          </motion.div>
        ))}
      </div>
      <hr />
      <div className="tot"><span>Paid calls</span><span>{receipt.length}</span></div>
      <div className="tot"><span>You pay{q.promo ? ' (free)' : o.refund ? ' (refunded)' : ''}</span><span>{price.toFixed(2)}</span></div>
      {bond > 0 && <div className="tot"><span>Bond paid to you</span><span>−{bond.toFixed(2)}</span></div>}
      {owner && <><hr /><div className="tot"><span>Tools (owner view)</span><span>{spent.toFixed(4)}</span></div><div className="tot big"><span>Margin</span><span>{(price - spent - bond).toFixed(4)}</span></div></>}
      <div className="foot">USDC · {o.demo ? 'demo receipt, no money moved' : 'paid per call via x402 on Arc'}</div>
    </div>
  );
}

const isVideo = (f: string) => /\.(mp4|webm)$/i.test(f);
const isImage = (f: string) => /\.(png|jpe?g|webp)$/i.test(f);
const isMedia = (f: string) => isVideo(f) || isImage(f) || /\.zip$/i.test(f);

/** What the growth team made: the live site in a phone frame, videos that play, images at full size. */
function Media({ id, files, deliverable, locked }: { id: string; files: string[]; deliverable: string; locked: boolean }) {
  // Until the work is accepted, pictures and video are watermarked previews and nothing downloads.
  const url = (f: string) => `/api/orders/${id}/files/${locked ? `preview-${f}` : f}`;
  files = files.filter((f) => !f.startsWith('preview-'));
  const site = deliverable.match(/\]\((?:https?:\/\/[^)\s]+)?(\/s\/[a-z0-9-]+)\)/)?.[1];
  const videos = files.filter(isVideo);
  const poster = files.find((f) => /^poster\./.test(f));
  const shots = files.filter((f) => /^(phone|laptop)\.jpg$/.test(f));
  const images = files.filter((f) => isImage(f) && !shots.includes(f) && f !== poster);
  if (!site && !videos.length && !images.length) return null;
  // a job that is mostly pictures (ad creatives, product shots) shows them before its videos
  const picturesFirst = images.length >= 4;
  const videoList = videos.map((f) => (
    <figure key={f} className={`media__video ${/1x1/.test(f) ? 'sq' : ''}`}>
      <video src={url(f)} poster={poster ? url(poster) : undefined} controls playsInline loop preload="metadata" controlsList={locked ? 'nodownload noplaybackrate' : undefined} disablePictureInPicture={locked} onContextMenu={locked ? (e) => e.preventDefault() : undefined} />
      <figcaption><span className="mono">{f}</span>{locked ? <span className="lockchip">Preview</span> : <a href={`${url(f)}?download`}>Download ↓</a>}</figcaption>
    </figure>
  ));
  return (
    <div className="media">
      {site && (
        <div className="media__site">
          <div className="phone"><iframe src={site} title="Your new site" loading="lazy" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" /></div>
          <div className="media__cap"><b>Live now</b><a href={site} target="_blank" rel="noreferrer">{`hiresyncly.site${site}`} ↗</a>{shots.length > 0 && <span className="muted">Laptop view below</span>}</div>
          {shots.filter((f) => f.startsWith('laptop')).map((f) => <img key={f} className="media__shot" src={url(f)} alt="The site on a laptop" loading="lazy" />)}
        </div>
      )}
      {!picturesFirst && videoList}
      {images.length > 0 && (
        <div className="media__grid">
          {images.map((f) => (
            <figure key={f}>{locked ? <img src={url(f)} alt={f} loading="lazy" onContextMenu={(e) => e.preventDefault()} /> : <a href={url(f)} target="_blank" rel="noreferrer"><img src={url(f)} alt={f} loading="lazy" /></a>}<figcaption><span className="mono">{f}</span>{locked ? <span className="lockchip">Preview</span> : <a href={`${url(f)}?download`}>↓</a>}</figcaption></figure>
          ))}
        </div>
      )}
      {picturesFirst && videoList}
    </div>
  );
}

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const Tx = ({ cfg, hash, children }: { cfg: EscrowCfg | null; hash?: string; children: ReactNode }) => {
  const href = txUrl(cfg, hash);
  return href ? <a href={href} target="_blank" rel="noreferrer">{children} ↗</a> : hash ? <span className="mono" title={hash}>{children}</span> : null;
};

/** Where this job's money went, step by step, each step linked to its Arc transaction. Tool costs stay private. */
function MoneyTrail({ o, receipt, cfg }: { o: Order; receipt: Receipt[]; cfg: EscrowCfg | null }) {
  const q = o.quote, e = o.escrow, p = o.payment, st = o.status;
  const settled = receipt.filter((r) => r.settledTx).length;
  const paidIn = p && p.mode !== 'promo';
  const end: { h: ReactNode; s?: ReactNode; on: boolean } =
    st === 'accepted' ? { h: paidIn ? 'Released to Syncly’s vault' : 'Accepted', s: e?.closeTx ? <Tx cfg={cfg} hash={e.closeTx}>Released</Tx> : o.decision?.by === 'auto' ? 'After 48 h of silence' : 'By you', on: true }
    : st === 'rejected' || (st === 'failed' && o.refund) ? { h: o.refund ? 'Refunded to you, plus the bond' : 'Rejected', s: o.refund?.tx ? <Tx cfg={cfg} hash={o.refund.tx}>Refund</Tx> : undefined, on: true }
    : st === 'expired' ? { h: 'The quote expired', s: 'Nothing was taken', on: true }
    : { h: 'Your decision', s: paidIn ? 'The money moves only when you accept, or after 48 h of silence' : 'Tell the team if it was good', on: false };
  const steps: { h: ReactNode; s?: ReactNode; on: boolean }[] = [
    { h: q.promo ? 'The CFO quoted it free' : `The CFO quoted ${usd(q.priceUsd)} USDC`, s: q.promo ? 'Paid from its promo budget for first jobs' : <>{q.bondUsd > 0 ? `and backed its quote with a ${usd(q.bondUsd)} USDC bond` : 'with no bond on this one'}{e?.openTx && <> · <Tx cfg={cfg} hash={e.openTx}>Escrow opened</Tx></>}</>, on: true },
    { h: !p ? 'Waiting for payment' : p.mode === 'promo' ? 'Nothing for you to pay' : p.mode === 'simulated' ? 'Paid into a demo escrow' : 'You paid into escrow on Arc', s: e?.fundTx ? <Tx cfg={cfg} hash={e.fundTx}>Funded</Tx> : paidIn ? 'Held by the contract, not by Syncly' : undefined, on: !!p },
    { h: `The team bought ${receipt.length} tool${receipt.length === 1 ? '' : 's'}`, s: receipt.length ? `${settled} settled on Arc so far, each paid from the agent’s own wallet` : 'Each agent pays per call from its own wallet', on: receipt.length > 0 },
    e ? { h: 'The delivery was sealed on Arc', s: e.submitTx ? <Tx cfg={cfg} hash={e.submitTx}>Fingerprint sealed</Tx> : 'Its hash goes on-chain before you decide', on: !!e.submitTx }
      : { h: 'Delivered', s: o.deliveredAt ? timeAgo(o.deliveredAt) : undefined, on: !!o.deliveredAt },
    end,
  ];
  return <ol className="trail">{steps.map((x, i) => <li key={i} className={x.on ? 'on' : ''}><b>{x.h}</b>{x.s && <span>{x.s}</span>}</li>)}</ol>;
}

/** A paid job's decision is signed by the wallet that funded the escrow. The server only reads the chain. */
function EscrowDecision({ o, cfg, onUpdate }: { o: Order; cfg: EscrowCfg; onUpdate: (o: Order) => void }) {
  const e = o.escrow!, q = o.quote;
  const [wallet, setWallet] = useState<boolean | null>(null);
  useEffect(() => setWallet(hasWallet()), []);
  const [who, setWho] = useState<Address | null>(null);
  const [email, setEmail] = useStored('outlay:email');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const sealed = e.state === 'Submitted';

  async function act(action: 'accept' | 'reject' | 'requestRevision') {
    setErr(null); setBusy(action);
    try {
      const a = who ?? (await connect(cfg));
      setWho(a);
      if (a.toLowerCase() !== e.customer.toLowerCase()) throw new Error(`This is ${short(a)}. Switch to the wallet that paid (${short(e.customer)}): only it can decide.`);
      if (action === 'requestRevision') {
        localStorage.setItem('outlay:email', email);
        await api(`/api/orders/${o.id}/sync`, { method: 'POST', body: JSON.stringify({ note, email }) }); // the chain records the request, not the note
      }
      const tx = await decideOnChain(cfg, a, e.id, action);
      onUpdate(await api<Order>(`/api/orders/${o.id}/sync`, { method: 'POST', body: JSON.stringify({ tx }) }));
    } catch (x: any) { setErr(walletError(x)); } finally { setBusy(null); }
  }

  if (!sealed) return <p className="muted" style={{ fontSize: 14.5 }}>The CFO is sealing the delivery's fingerprint on Arc. Your decision opens in a moment…</p>;
  return (
    <div className="form" style={{ gap: 14 }}>
      <p style={{ fontSize: 14.5, color: 'var(--ink-2)' }}>
        Accept to release <b>{usd(q.priceUsd)} USDC</b> from escrow to Syncly. Reject and the contract returns it <b>plus a {usd(q.bondUsd)} USDC bond</b>. Decide by <b>{when(e.acceptBy)}</b>; silence counts as acceptance.
      </p>
      <p className="muted" style={{ fontSize: 13 }}>Signed by the wallet that paid: <span className="mono">{short(e.customer)}</span>{who && who.toLowerCase() === e.customer.toLowerCase() && ' · connected ✓'}</p>
      {wallet === false && <div className="note">Open this page in the wallet app that paid ({short(e.customer)}) to decide.</div>}
      {o.revisionNote === undefined && (
        <>
          <label className="field">Want changes? <span className="hint">One free revision. The team re-runs the job with your note.</span>
            <textarea style={{ minHeight: 76 }} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="e.g. focus on Ikoyi too, and add opening hours" />
          </label>
          {note.trim() && (
            <label className="field">Your email <span className="hint">the one on this order, so only you can add the note</span>
              <input type="email" value={email} onChange={(ev) => setEmail(ev.target.value)} placeholder="you@business.com" />
            </label>
          )}
        </>
      )}
      <div className="decide">
        <button className="btn primary block" disabled={!!busy || wallet === false} onClick={() => act('accept')}>{busy === 'accept' ? 'Confirm in your wallet…' : `Accept & release ${usd(q.priceUsd)} USDC`}</button>
        <div className="row">
          {o.revisionNote === undefined && <button className="btn secondary" disabled={!!busy || wallet === false || !note.trim() || !email} onClick={() => act('requestRevision')}>{busy === 'requestRevision' ? 'Confirm…' : 'Revise'}</button>}
          <button className="btn danger" disabled={!!busy || wallet === false} onClick={() => act('reject')} style={o.revisionNote !== undefined ? { gridColumn: 'span 2' } : undefined}>{busy === 'reject' ? 'Confirm…' : 'Reject & refund'}</button>
        </div>
      </div>
      {err && <div className="error">{err}</div>}
    </div>
  );
}

/** What already happened on a live job (the brief arriving, its steps and payments so far), for the office to catch up on. */
function missedEvents(o: Order): OfficeEvent[] {
  const live = (o as any).live as { steps?: Step[]; receipt?: Receipt[] } | null;
  const ev: OfficeEvent[] = [{ type: 'order', orderId: o.id, at: (o as any).payment?.at ?? o.createdAt, data: { status: 'queued', service: o.service, team: (o as any).team ?? [], promo: o.quote.promo, price: o.quote.priceUsd, bond: o.quote.bondUsd, brief: o.brief.length > 90 ? o.brief.slice(0, 88) + '…' : o.brief } }];
  for (const s of live?.steps ?? []) ev.push({ type: 'step', orderId: o.id, at: s.at, data: s });
  for (const p of live?.receipt ?? []) ev.push({ type: 'purchase', orderId: o.id, at: p.at, data: p });
  return [ev[0], ...ev.slice(1).sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''))];
}

export default function Job({ id }: { id: string }) {
  const [o, setO] = useState<Order | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [email, setEmail] = useStored('outlay:email');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [replay, setReplay] = useState(0);
  const { data: escCfg } = useApi<EscrowCfg | { enabled: false }>('/api/escrow');
  const { data: services } = useApi<{ services: Service[] }>('/api/services');
  const cfg = escCfg?.enabled ? escCfg : null;

  const load = () => api<Order>(`/api/orders/${id}`).then(setO).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]);
  const active = o && ['queued', 'running', 'revision'].includes(o.status);
  // A delivered order can still change from elsewhere (another tab, the 48 h auto-accept), so keep listening.
  const retryPaid = !!o && o.status === 'failed' && !o.refund && o.escrow?.state === 'Funded' && Date.now() < Date.parse(o.escrow.deliverBy) - 20 * 60_000; // matches canRetryPaid on the server
  const awaitingNaira = o?.status === 'quoted' && o?.naira?.status === 'open'; // the page turns into the live job when the naira lands
  const listening = active || awaitingNaira || o?.status === 'delivered' || (o?.status === 'failed' && o.escrow?.state === 'Funded');
  useEffect(() => {
    if (!listening) return;
    const es = new EventSource(`/api/events?order=${id}`);
    const bump = () => load();
    es.addEventListener('step', bump);
    es.addEventListener('purchase', bump);
    es.addEventListener('order', bump);
    const t = active || awaitingNaira ? setInterval(load, 4000) : undefined;
    return () => { es.close(); clearInterval(t); };
  }, [id, listening, active, awaitingNaira]);

  const last = o?.runs.at(-1);
  const running = o?.live && (!last || last.id !== o.live.jobId) && active ? o.live : null;
  const steps: Step[] = running?.steps ?? last?.steps ?? [];
  const receipt: Receipt[] = running?.receipt ?? last?.receipt ?? [];
  const html = useMemo(() => (last?.deliverable ? DOMPurify.sanitize(marked.parse(last.deliverable, { async: false }) as string) : ''), [last?.deliverable]);

  async function decide(action: 'accept' | 'reject' | 'revise' | 'retry') {
    setBusy(true); setErr(null);
    try {
      localStorage.setItem('outlay:email', email);
      setO(await api<Order>(o?.naira && action !== 'retry' ? `/api/orders/${id}/naira-decide` : `/api/orders/${id}/${action}`, { method: 'POST', body: JSON.stringify(o?.naira ? { email, note, action } : { email, note }) }));
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  if (err && !o) return <main className="wrap section center"><h1 className="h1">Couldn't find this job.</h1><p className="muted" style={{ margin: '12px 0 24px' }}>{err}</p><Link href="/" className="btn secondary">Back to Syncly</Link></main>;
  if (!o) return <main className="wrap section"><div className="skel" style={{ height: 480 }} /></main>;
  const q = o.quote;

  const locked = !(o as any).released;
  const svc = services?.services.find((x) => x.id === o.service);
  const title = `${SERVICE_NAME[o.service] ?? o.service}${o.details?.name ? ` for ${o.details.name}` : ''}`;
  const now = steps.at(-1);
  const startedAt = running ? Date.parse((running.steps[0]?.at ?? o.payment?.at ?? o.createdAt)) : 0;
  const naira = (x: number) => `₦${Math.round(x).toLocaleString('en-NG')}`;
  const files = last?.files.filter((f) => !f.startsWith('preview-')) ?? [];
  const docFiles = files.filter((f) => !isImage(f) && !isVideo(f));
  const hasMedia = files.some((f) => isImage(f) || isVideo(f)) || /\]\((?:https?:\/\/[^)\s]+)?\/s\/[a-z0-9-]+\)/.test(last?.deliverable ?? '');
  const qaBox = last?.qa ? <div className={`qa ${last.qa.verdict === 'pass' ? 'pass' : 'revise'}`} style={{ margin: '4px 0 18px' }}><Avatar role="auditor" /><div><b>Auditor {last.qa.verdict === 'pass' ? 'passed it' : 'left notes'}</b> <span style={{ opacity: .75 }}>· {last.qa.model}</span>{last.qa.notes && <div style={{ fontSize: 13.5, marginTop: 2 }}>{last.qa.notes}</div>}</div></div> : null;

  const decisionPanel = () => {
    if (o.status === 'delivered' && o.escrow && !o.naira) return cfg ? <EscrowDecision o={o} cfg={cfg} onUpdate={setO} /> : <p className="muted">Loading the escrow…</p>;
    if (o.status !== 'delivered') return null;
    return (
      <div className="form" style={{ gap: 14 }}>
        <p style={{ fontSize: 14.5, color: 'var(--ink-2)', margin: 0 }}>
          {q.promo ? 'This one was free. Tell us if it was good.' : o.naira ? <>Accept to release your {naira(o.naira.ngn)} payment and unlock the full-quality files. Reject and you get it all back in naira <b>plus a {naira(q.bondUsd * o.naira.rate)} bond</b>.</> : <>Accept to release <b>{usd(q.priceUsd)} USDC</b> and unlock the files. Reject and you get it all back <b>plus a {usd(q.bondUsd)} USDC bond</b>.</>} Silence for 48 h counts as acceptance.
        </p>
        <label className="field">Confirm with your email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" />
        </label>
        {o.revisionNote === undefined && (
          <label className="field">Want changes? <span className="hint">One free revision.</span>
            <textarea style={{ minHeight: 76 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. bigger text, show the fridges first, end on our WhatsApp number" />
          </label>
        )}
        <div className="decide">
          <button className="btn primary block" disabled={busy || !email} onClick={() => decide('accept')}>{locked ? 'Accept & unlock the files' : 'Accept the work'}</button>
          <div className="row">
            {o.revisionNote === undefined && <button className="btn secondary" disabled={busy || !email || !note.trim()} onClick={() => decide('revise')}>Revise</button>}
            <button className="btn danger" disabled={busy || !email} onClick={() => decide('reject')} style={o.revisionNote !== undefined ? { gridColumn: 'span 2' } : undefined}>Reject{q.promo ? '' : ' & refund'}</button>
          </div>
        </div>
        {err && <div className="error">{err}</div>}
      </div>
    );
  };

  return (
    <main className="wrap jobpage">
      <div className="jobtop">
        <div className="crumbs"><Link href={`/hire/${o.service}`}>{SERVICE_NAME[o.service] ?? o.service}</Link><span>/</span><span className="mono" style={{ fontSize: 13 }}>{o.id}</span></div>
        <div className="jobhead">
          <div>
            <h1 className="h2">{title}</h1>
            <div className="meta">Ordered {timeAgo(o.createdAt)} by {o.email}{o.demo && ' · demo mode: no real money moved'}</div>
          </div>
          <span className={`badge ${o.status}`}><span className="dot" />{o.status === 'queued' ? 'starting' : o.status}</span>
        </div>
        <Stepper o={o} />
      </div>

      {/* The stage: one thing at a time, whatever the job needs from you now */}
      {awaitingNaira ? (
        <section className="card pad stage">
          <h3 className="t">Waiting for your naira payment</h3>
          <p className="muted" style={{ margin: 0 }}>A bank transfer through Bachs can take a few minutes. This page updates by itself once it lands, and the team starts straight away.</p>
        </section>
      ) : active ? (
        <section className="stage">
          <div className="minioffice">
            <Office orderId={o.id} team={(o as any).team} idleReplayMs={0} replayToken={replay} backlog={missedEvents(o)} working={(o as any).team} directorOnStart />
            <div className="overlay"><span className="chip live"><span className="dot" />Live</span></div>
          </div>
          <div className="nowline">
            {now ? <><Avatar role={now.agent} /><div><b>{ROLE_NAME[now.agent] ?? now.agent}</b> <span>{now.step}{now.note ? ` · ${now.note}` : ''}</span></div></> : <><Avatar role="cfo" /><div><b>The CFO</b> <span>is staffing the job…</span></div></>}
          </div>
          <Progress startedAt={startedAt} etaMin={svc?.etaMin} steps={steps.length} />
          <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>You can close this page. We'll email you when it's ready, and your decision waits here.</p>
        </section>
      ) : o.status === 'failed' ? (
        <section className="card pad stage">
          <div className="form" style={{ gap: 12 }}>
            <div className="qa revise"><Avatar role="cfo" /><div>We couldn't deliver this one{o.refund ? `: ${usd(o.refund.priceUsd)} refunded + ${usd(o.refund.bondUsd)} bond paid` : ''}. {last?.error}{o.refund?.tx && <> <Tx cfg={cfg} hash={o.refund.tx}>Refund on Arc</Tx></>}</div></div>
            {o.escrow && !o.refund && (o.naira
              ? <p style={{ fontSize: 14, color: 'var(--ink-2)', margin: 0 }}>Your {naira(o.naira.ngn)} is safe: the {usd(q.priceUsd)} USDC it paid for is held in escrow on Arc. If the job isn't delivered by the deadline ({when(o.escrow.deliverBy)}), the contract refunds it and we send your {naira(o.naira.ngn)} back through Bachs, plus a {naira(q.bondUsd * o.naira.rate)} bond.</p>
              : <p style={{ fontSize: 14, color: 'var(--ink-2)', margin: 0 }}>Your {usd(q.priceUsd)} USDC is safe in escrow. At the deadline ({when(o.escrow.deliverBy)}) the contract refunds it plus the {usd(q.bondUsd)} USDC bond. The CFO triggers the refund, and anyone can.</p>)}
            {(o.payment?.mode === 'promo' || retryPaid) && (
              <>
                <p style={{ fontSize: 14, color: 'var(--ink-2)', margin: 0 }}>{retryPaid ? "The team can try again now, at no extra cost to you. If it still can't deliver, the refund above stands." : "It's still your free job. The team can try again; you only see what they spend on the receipt."}</p>
                <label className="field">Confirm with your email
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" />
                </label>
                <button className="btn primary block" disabled={busy || !email} onClick={() => decide('retry')}>Try again</button>
                {err && <div className="error">{err}</div>}
              </>
            )}
          </div>
        </section>
      ) : html ? (
        <>
          <section className="card pad stage">
            <div className="dochead">
              <h3>{locked ? 'Your preview' : 'Your work'}</h3>
              <div className="btns">
                {locked ? <span className="lockchip big">Full quality unlocks when you accept</span> : (
                  <>
                    {docFiles.map((f) => <a key={f} className="btn secondary sm" href={`/api/orders/${o.id}/files/${f}${isMedia(f) ? '?download' : ''}`}>↓ {f}</a>)}
                    <a className="btn secondary sm" href={`/api/orders/${o.id}/files/deliverable.md`}>↓ .md</a>
                  </>
                )}
              </div>
            </div>
            {(o as any).withdrawn ? <p className="muted">This work wasn't kept, so its files are gone.</p> : <Media id={o.id} files={files} deliverable={last!.deliverable} locked={locked} />}
            {/* With pictures or video to look at, the write-up folds away so the decision sits right under them */}
            {hasMedia ? (
              <details className="notes">
                <summary>What the team wrote{last?.qa ? ` · auditor ${last.qa.verdict === 'pass' ? 'passed it' : 'left notes'}` : ''}</summary>
                {qaBox}
                <div className="deliverable" dangerouslySetInnerHTML={{ __html: html }} />
              </details>
            ) : <>{qaBox}<div className="deliverable" dangerouslySetInnerHTML={{ __html: html }} /></>}
          </section>

          {o.status === 'delivered' && !hasMedia && <a href="#decide" className="decidebar">Ready for your decision <b>Accept, revise or reject ↓</b></a>}
          {o.status === 'delivered' && <section className="card pad decisioncard" id="decide"><h3 className="t">Your decision</h3>{decisionPanel()}</section>}
          {o.status === 'accepted' && <div className="qa pass"><Avatar role="cfo" /><div>Accepted {o.decision?.by === 'auto' ? 'automatically after 48 h' : 'by you'} · {timeAgo(o.decision!.at)}. Thank you.{o.escrow?.closeTx && <> <Tx cfg={cfg} hash={o.escrow.closeTx}>Payment released on Arc</Tx></>}</div></div>}
          {o.status === 'rejected' && <div className="qa revise"><Avatar role="cfo" /><div>Rejected{o.naira?.refund ? `: ${naira(o.naira.refund.ngn)} ${o.naira.refund.status === 'paid' ? 'refunded' : 'being refunded'} through Bachs${o.naira.refund.bondNgn ? `, and the ${naira(o.naira.refund.bondNgn)} bond is owed to you (we'll send it to your bank account)` : ''}` : o.refund ? `: ${usd(o.refund.priceUsd)} refunded + ${usd(o.refund.bondUsd)} bond paid` : ''}. The CFO will learn from this.{o.refund?.tx && <> <Tx cfg={cfg} hash={o.refund.tx}>Refund on Arc</Tx></>}</div></div>}
          {o.status === 'accepted' && o.details?.name && <MoreFor o={o} />}
        </>
      ) : o.status === 'expired' ? (
        <section className="card pad stage"><p className="muted" style={{ fontSize: 14.5, margin: 0 }}>This quote expired before it was paid. Nothing was taken. <Link href={`/hire/${o.service}`}>Get a new quote →</Link></p></section>
      ) : (
        <section className="card pad stage"><p className="muted" style={{ fontSize: 14.5, margin: 0 }}>You'll decide once the work is delivered, usually within a few minutes. Keep this link: it's where your work and your decision live.</p></section>
      )}

      {/* Everything else, folded away */}
      <div className="jobmore">
        <details>
          <summary>How the team did it <small>{steps.length} steps{receipt.length ? ` · ${receipt.length} paid tools` : ''}</small></summary>
          <div className="jobmore__in">
            {!active && o.runs.length > 0 && (
              <div className="minioffice" style={{ marginBottom: 14 }}>
                <Office orderId={o.id} team={(o as any).team} idleReplayMs={0} replayToken={replay} />
                <div className="overlay"><button className="btn secondary sm" onClick={() => setReplay((x) => x + 1)}>▶ Replay this job</button></div>
              </div>
            )}
            <Timeline steps={steps} />
          </div>
        </details>
        <details>
          <summary>The money on this job <small>{q.promo ? 'free' : o.naira ? `${naira(o.naira.ngn)} via Bachs` : `${usd(q.priceUsd)} USDC`}{o.escrow ? ` · escrow ${o.escrow.state.toLowerCase()}` : ''}</small></summary>
          <div className="jobmore__in moneygrid">
            <div>
              <MoneyTrail o={o} receipt={receipt} cfg={cfg} />
              <div className="srow"><span className="lbl">Price</span><span className="fill" /><span className="v">{q.promo ? 'Free' : `${usd(q.priceUsd)} USDC`}</span></div>
              {!q.promo && <div className="srow"><span className="lbl">In naira</span><span className="fill" /><span className="v">{o.naira ? naira(o.naira.ngn) : ngn(q.priceUsd)}</span></div>}
              <div className="srow"><span className="lbl">Bond if rejected</span><span className="fill" /><span className="v">{q.promo ? '—' : `${usd(q.bondUsd)} USDC`}</span></div>
              {o.escrow && <div className="srow"><span className="lbl">Paid by</span><span className="fill" /><span className="v">{o.naira ? 'NairaDesk (for you)' : short(o.escrow.customer)}</span></div>}
              {o.escrow && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>The terms sealed on-chain</summary>
                  <p className="muted" style={{ fontSize: 12.5, margin: '8px 0 6px' }}>keccak256 of this text is the job's specHash on Arc: <span className="mono" style={{ wordBreak: 'break-all' }}>{o.escrow.specHash}</span></p>
                  <pre className="spec">{o.escrow.spec}</pre>
                </details>
              )}
              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>Why the CFO priced it this way</summary>
                <ol className="why">{q.reasons.map((r) => <li key={r}>{r}</li>)}</ol>
              </details>
            </div>
            <PaperReceipt o={o} receipt={receipt} />
          </div>
        </details>
      </div>
    </main>
  );
}

/** How far along a live job is: time against the service's usual time, so a long render doesn't look stuck. */
function Progress({ startedAt, etaMin, steps }: { startedAt: number; etaMin?: number; steps: number }) {
  const [t, setT] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setT(Date.now()), 1000); return () => clearInterval(i); }, []);
  const mins = Math.max(0, (t - startedAt) / 60000), eta = Math.max(1, etaMin ?? 5);
  const pct = Math.min(94, 6 + (mins / eta) * 88);
  const left = eta - mins;
  return (
    <div className="jobprogress">
      <div className="bar"><span style={{ width: `${pct}%` }} /></div>
      <div className="lbls"><span>{steps} step{steps === 1 ? '' : 's'} so far · {Math.floor(mins)}:{String(Math.floor((mins % 1) * 60)).padStart(2, '0')} elapsed</span><span>{left > 0.5 ? `usually about ${Math.ceil(left)} min more` : 'finishing up: big renders take a little longer'}</span></div>
    </div>
  );
}
