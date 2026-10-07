'use client';
// The home page's customer-facing sections, in the order a business owner needs them: what the team can do (every
// service with a small picture of what you get), real work, how you pay, and the questions people ask. The story of
// how the company runs (the CFO, the money, the team, the office) follows them on the page.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Rv, SplitLines } from '@/components/scroll.tsx';
import { NGN_PER_USD, type Service } from '@/lib.tsx';

const Arrow = () => <span className="pill__ic">→</span>;
const naira = (usd: number) => `₦${(Math.round((usd * NGN_PER_USD) / 50) * 50).toLocaleString('en-NG')}`;

// ---------------------------------------------------------------- a small picture of what each service delivers

const WA = <svg viewBox="0 0 24 24" aria-hidden><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z" /></svg>;

export function Preview({ id }: { id: string }) {
  switch (id) {
    case 'website': return (
      <div className="pv pv-site"><div className="phone"><i className="bar" /><b className="h">Portraits that make you look twice</b><i className="l" /><i className="l s" /><span className="btn">{WA}WhatsApp</span><div className="ph" /></div></div>
    );
    case 'content-pack': return (
      <div className="pv pv-posts">{['#f2c14e', '#2e7a38', '#c0392b', '#13271c', '#e8dcc6', '#c8902f'].map((c, i) => <i key={i} style={{ background: c }}><span>♥ {[812, 340, 1.2, 96, 455, 2.1][i]}{i === 2 || i === 5 ? 'k' : ''}</span></i>)}</div>
    );
    case 'ad-launch': return (
      <div className="pv pv-ads">{['Party trays from ₦25k', 'Hot, on time, every time'].map((t, i) => <div key={t} className="ad" style={{ ['--r' as any]: `${i ? 5 : -5}deg` }}><span className="sp">Sponsored</span><i className="img" style={{ background: i ? '#2e7a38' : '#c0392b' }} /><b>{t}</b><span className="cta">Send message</span></div>)}</div>
    );
    case 'motion-ad': return (
      <div className="pv pv-video"><div className="frame"><b>Power up<br />your home</b><span className="play">▶</span><i className="prog"><i /></i></div><span className="music">♪ licensed music · 16 s</span></div>
    );
    case 'flyers': return (
      <div className="pv pv-flyer"><div className="sheet"><span className="lg">T</span><b>Price list</b>{[['Party tray (20)', '₦25,000'], ['Party tray (50)', '₦58,000'], ['Puff-puff (50)', '₦6,000'], ['Samosa (50)', '₦12,000']].map(([a, b]) => <p key={a}><span>{a}</span><em /><span>{b}</span></p>)}<span className="cta">{WA}Order on WhatsApp</span></div></div>
    );
    case 'product-photos': return (
      <div className="pv pv-photos"><div className="before"><i className="jar" /><span>Your photo</span></div><span className="arr">→</span><div className="after"><i className="jar" /><span>Studio shot</span></div></div>
    );
    case 'get-found': return (
      <div className="pv pv-maps"><div className="grid">{[3, 1, 2, 5, 1, 1, 9, 4, 2].map((n, i) => <i key={i} className={n <= 3 ? 'g' : n <= 6 ? 'a' : 'r'}>{n}</i>)}</div><div className="side"><span><b>3 rivals</b> charge ₦3,500–₦4,200</span><span><b>ChatGPT</b> has your old hours</span></div></div>
    );
    case 'buy-smart': return (
      <div className="pv pv-buy">{[['Konga', '₦412,000', 'g', 'Safe'], ['@frostking_ng', '₦389,000', 'a', 'Check'], ['Jiji seller', '₦305,000', 'r', 'Risky']].map(([s, p, c, l]) => <p key={s}><span>{s}</span><b>{p}</b><i className={c}>{l}</i></p>)}</div>
    );
    case 'find-customers': return (
      <div className="pv pv-leads">{[['Bloom Salon', 'No website'], ['Mama Tee Kitchen', 'New · 12 reviews'], ['Glow Spa Wuse', 'No website']].map(([n, s]) => <p key={n}><span className="av">{n[0]}</span><span className="t"><b>{n}</b><small>{s}</small></span><span className="wa">{WA}</span></p>)}<span className="ready">✓ a first message for each</span></div>
    );
    case 'money-report': return (
      <div className="pv pv-money"><div className="bars">{[[62, 70], [80, 58], [70, 66], [92, 61]].map(([a, b], i) => <span key={i}><i className="in" style={{ height: `${a}%` }} /><i className="out" style={{ height: `${b}%` }} /></span>)}</div><div className="rows"><span>Rent <b>38%</b></span><span>Stock <b>31%</b></span><span>Charges <b>₦48k/yr</b></span><span className="ok">✓ reconciled</span></div></div>
    );
    default: return <div className="pv" />;
  }
}

// ---------------------------------------------------------------- 01 · what we do

const DEPTS: [string, string][] = [['all', 'Everything'], ['Marketing', 'Marketing'], ['Sales & Research', 'Find customers'], ['Money', 'Money'], ['Buying', 'Buying']];

export function WhatWeDo({ services }: { services: Service[] }) {
  const [dept, setDept] = useState('all');
  const live = services.filter((s) => s.live);
  const shown = live.filter((s) => dept === 'all' || s.dept === dept);
  // This section appears once the services load, after the browser has already tried to jump to #services.
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (location.hash === '#services') ref.current?.scrollIntoView({ block: 'start' }); }, []);
  return (
    <section className="ww wrap" id="services" ref={ref}>
      <div className="ww__head">
        <span className="label"><span className="n">01</span>What we do</span>
        <SplitLines text="Everything a small business needs done. $1 each." />
        <Rv as="p" className="lede">Pick a job, fill a short form, and a team of AI agents does it in minutes. You see the price before anything starts and only pay if you accept the work.</Rv>
        <div className="ww__tabs" role="tablist">{DEPTS.filter(([k]) => k === 'all' || live.some((s) => s.dept === k)).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={dept === k} className={`chip click${dept === k ? ' on' : ''}`} onClick={() => setDept(k)}>{l}</button>)}</div>
      </div>
      <div className="ww__grid">
        {shown.map((s) => (
          <Link key={s.id} href={`/hire/${s.id}`} className="ww__card">
            <Preview id={s.id} />
            <div className="ww__body">
              <h3>{s.name}</h3>
              <p>{s.tagline}</p>
              <div className="ww__meta"><span><b>${s.priceUsd}</b> · {naira(s.priceUsd)}</span><span>about {s.etaMin} min</span></div>
            </div>
            <span className="ww__go">Order <Arrow /></span>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- 03 · real work

export function RealWork({ stats }: { stats: { delivered: number; customers: number; settled: number } | null }) {
  return (
    <section className="rw wrap" id="work">
      <div className="rw__grid">
        <div>
          <span className="label"><span className="n">03</span>Real work</span>
          <SplitLines text="Real businesses. Real work. Live today." />
          <Rv as="p" className="lede">Dre runs a portrait studio in Wuse, Abuja. He saw the team on an Instagram story, and his website was live the same day: his best photos, his services, and WhatsApp, call and directions on every screen.</Rv>
          <div className="rw__stats">
            <div><b>{stats?.delivered ?? '—'}</b><span>jobs delivered</span></div>
            <div><b>{stats?.customers ?? '—'}</b><span>businesses served</span></div>
            <div><b>{stats?.settled ?? '—'}</b><span>payments settled on Arc</span></div>
          </div>
          <div className="rw__cta">
            <a className="pill dark" href="/s/shot-by-dre-6628" target="_blank" rel="noreferrer">See Dre's site <Arrow /></a>
            <Link className="pill green" href="/hire/website">Get one like it <Arrow /></Link>
          </div>
        </div>
        <Rv className="rw__phone" delay={0.15}><img src="/proof/shot-by-dre.jpg" alt="Shot By Dre's website, built by the team, on a phone" /><span className="rw__badge mono">Built by Syncly · live at hiresyncly.site/s/shot-by-dre</span></Rv>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- 04 · pay your way

export function PayYourWay() {
  return (
    <section className="py wrap" id="pay">
      <div className="py__head">
        <span className="label"><span className="n">04</span>Pay your way</span>
        <SplitLines text="Pay in naira or USDC. Only if you accept." />
      </div>
      <div className="py__grid">
        <Rv className="py__card">
          <span className="mono py__k">Naira</span>
          <b className="py__big">≈ {naira(1)}</b>
          <p>Pay by <b>bank transfer or card</b> through Bachs, like paying any business. No wallet, no crypto.</p>
          <span className="py__fine">Our naira desk on Arc puts the money for your job into escrow for you.</span>
        </Rv>
        <Rv className="py__card" delay={0.08}>
          <span className="mono py__k">USDC</span>
          <b className="py__big">$1</b>
          <p>Pay <b>from your own wallet</b> on Arc. USDC on another chain? Bring it over in a minute with <Link href="/arc">Get USDC</Link>.</p>
          <span className="py__fine">Works with MetaMask, Rabby, Coinbase Wallet and other wallets.</span>
        </Rv>
        <Rv className="py__card py__promise" delay={0.16}>
          <span className="mono py__k">Our promise</span>
          <ul>
            <li><b>The price is fixed</b> before anything starts.</li>
            <li><b>Your money waits in escrow</b>, not with us, until you accept.</li>
            <li><b>One free revision</b> if it's not quite right.</li>
            <li><b>Reject it</b> and you get your money back, plus a bond.</li>
          </ul>
        </Rv>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- questions

const QA: [string, React.ReactNode][] = [
  ['Do I need crypto?', <>No. Pay in naira by bank transfer or card. If you already hold USDC, you can pay with that instead.</>],
  ['What if I don’t like the work?', <>Ask for one free revision with what to change, or reject it: you get your money back in full, plus a bond the CFO put up when it took your job.</>],
  ['How fast is it?', <>Most jobs are done in 2 to 5 minutes. You can watch the team work on your job page while it happens.</>],
  ['Is it really $1?', <>Yes. Every service is $1 (about {naira(1)}) while we grow. You always see the exact price before you pay.</>],
  ['Who does the work?', <>A team of AI agents, each with one job: one finds things, one reads, one writes, one designs, one checks. A separate AI audits the work before it reaches you, and every step is shown on your job page.</>],
  ['Is my information private?', <>Your full-quality files unlock only when you accept. Bank statements for a Money Report are deleted when the report is done, and the report opens only from the private link in your email.</>],
];

export function Questions() {
  return (
    <section className="qa-s wrap" id="questions">
      <div className="qa-s__grid">
        <div>
          <span className="label"><span className="n">09</span>Questions</span>
          <SplitLines text="Before you order." />
          <Rv as="p" className="lede">Still unsure? <Link href="/docs/faq">Read the full FAQ</Link>, or order the $1 job you need most and see for yourself.</Rv>
        </div>
        <div className="qa-s__list">{QA.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>
      </div>
    </section>
  );
}
