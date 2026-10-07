'use client';
// The home page, told by scrolling (after quickfleet.co): a full-bleed hero, the CFO on a blueprint, the
// money's path from invoice to audit trail, the team on a pinned stage, how a job works on stacking cards,
// the office, the services on a pinned index, and a dark close. Every number shown comes from the live API.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Office from '@/office/Office.tsx';
import { useApi, timeAgo, ROLE_NAME, ROLES, DEPT_TINT, Avatar, type Service, type AgentStats } from '@/lib.tsx';
import { clamp, Rv, SplitLines, useFrame, useInView, useStickyProgress } from '@/components/scroll.tsx';
import { DecideArt, EscrowArt, MarkBlock, QuoteArt, ReceiptArt, VaultArt } from './home/art.tsx';
import { PayYourWay, Questions, RealWork, WhatWeDo } from './home/sections.tsx';

type Stats = { mode: 'demo' | 'live'; toolCalls: number; settled: number; delivered: number; customers: number };
type Cfo = { enabled: boolean; mode: string; metrics: { done: number; escalated: number }; verify: { ok: boolean; entries: number }; snapshot: null | { buckets: Record<string, number>; epoch?: number }; decisions: { summary: string; at: string; tx?: string; status: string; kind: string; hash?: string }[] };

const Arrow = () => <span className="pill__ic">→</span>;
// The jobs people ask for most, straight from the hero (every service is on the menu below)
const HERO_MENU: [string, string][] = [['website', 'Website'], ['flyers', 'Flyers'], ['motion-ad', 'Promo video'], ['ad-launch', 'Ads'], ['find-customers', 'Find customers'], ['money-report', 'Money report']];

// ---------------------------------------------------------------- hero

function Hero({ stats }: { stats: Stats | null }) {
  const media = useRef<HTMLDivElement>(null);
  useFrame(() => {
    const el = media.current;
    if (!el) return;
    const t = clamp(window.scrollY / window.innerHeight);
    el.style.transform = `scale(${1.04 + t * 0.08})`; // grows from the top edge, so the sign stays in frame
  });
  return (
    <section className="hx">
      <div className="hx__panel">
        <div className="hx__media" ref={media}><img src="/scene/building-1920.webp" alt="Syncly HQ: a three-storey office where the AI team works" /></div>
        <div className="hx__shade" />
        <div className="hx__copy">
          <span className="hx__tag"><span className="dot" />{stats?.mode === 'demo' ? 'Demo mode · nothing real moves' : 'Live on Arc mainnet'}</span>
          <SplitLines as="h1" text={"Your business's AI\u00a0team. Every\u00a0job\u00a0$1."} />
          <Rv as="p" delay={0.35}>
            <span className="hx__long">Websites, flyers, promo videos, ads, product photos, new customers and a report on where your money goes. Order in a minute, watch a team of AI agents do it, and pay in naira or USDC only if you accept the work. An AI CFO runs the money: your payment waits in escrow on Arc until you say yes.</span>
            <span className="hx__short">Websites, flyers, videos, ads and new customers, done by AI agents. Pay in naira or USDC, only if you accept the work.</span>
          </Rv>
          <Rv className="hx__cta" delay={0.5}>
            <Link href="/#services" className="pill white lg">See what we do <Arrow /></Link>
            <Link href="/#money" className="pill ghost lg">How the AI CFO works <Arrow /></Link>
          </Rv>
          <Rv className="hx__menu" delay={0.62}>
            {HERO_MENU.map(([id, label]) => <Link key={id} href={`/hire/${id}`}>{label}</Link>)}
          </Rv>
        </div>
        <div className="hx__foot mono"><span>Pay in naira or USDC · only if you accept · every job $1</span><span>Scroll ↓</span></div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- 01 · the team, on a pinned stage

const CREW: { role: string; buys: string; from: string; line: string }[] = [
  { role: 'scout', buys: 'Search and maps', from: 'Exa · Serper', line: 'Finds every business, page and source the brief asks for.' },
  { role: 'researcher', buys: 'AI models', from: 'BlockRun', line: 'Turns your sentence into a search plan, then pulls out the facts.' },
  { role: 'reader', buys: 'Page reading', from: 'Exa · APEX', line: 'Opens the websites and reads what matters on them.' },
  { role: 'writer', buys: 'AI models', from: 'BlockRun', line: 'Writes the posts, the ad copy, the briefs, and a personal first line for every lead.' },
  { role: 'illustrator', buys: 'AI models and images', from: 'BlockRun on Arc', line: 'Builds your website and makes the product photos and ad creatives.' },
  { role: 'producer', buys: 'Video and music', from: 'BlockRun on Arc', line: 'Makes the motion ads, and the video in every ad launch.' },
  { role: 'investigator', buys: 'Checks and screening', from: 'APEX · DataForSEO · Didit', line: 'Checks every email, phone number and seller, and asks ChatGPT what it says about you.' },
  { role: 'analyst', buys: 'AI models', from: 'BlockRun', line: 'Compares prices, answers and signals: the numbers on every report.' },
  { role: 'auditor', buys: 'A second model family', from: 'BlockRun', line: 'Checks the work on a different AI before it is delivered.' },
  { role: 'messenger', buys: 'Email delivery', from: 'Resend', line: 'Packs the files and gets them to you.' },
];

function Team({ agents }: { agents: Record<string, AgentStats> }) {
  const ref = useRef<HTMLElement>(null);
  const [at, setAt] = useState(0);
  useStickyProgress(ref, (p) => setAt(Math.min(CREW.length - 1, Math.floor(p * CREW.length))));
  return (
    <section className="tm" id="team" ref={ref} style={{ ['--n' as any]: CREW.length }}>
      <div className="tm__stick">
        <div className="tm__copy">
          <span className="label"><span className="n">07</span>The team</span>
          <div className="tm__steps">
            {CREW.map((c, i) => {
              const s = agents[c.role];
              return (
                <div key={c.role} className={`tm__step${i === at ? ' on' : i < at ? ' past' : ''}`} aria-hidden={i !== at}>
                  <h2>{ROLE_NAME[c.role]}</h2>
                  <p className="tm__role">{ROLES[c.role]?.title}</p>
                  <p>{c.line} It works like a contractor: its own wallet, a weekly allowance from the CFO, and it pays for its own tools one call at a time.</p>
                  <span className="tm__stat"><span className="dot" />{s?.calls ? `${s.calls} paid calls, settled on Arc` : 'On the team, waiting for its first paid call'}</span>
                </div>
              );
            })}
          </div>
          <div className="tm__mobile">
            {CREW.map((c) => <div key={c.role} className="tm__mcard"><img src={`/sprites/${c.role}/${c.role}-0.png`} alt="" /><div><b>{ROLE_NAME[c.role]}</b><span>{c.line}</span></div></div>)}
          </div>
        </div>
        <div className="tm__stage">
          <div className="tm__top mono"><span><span className="dot" />Syncly HQ</span><span className="tm__prog">{CREW.map((c, i) => <i key={c.role} className={i <= at ? 'on' : ''} />)}</span></div>
          {CREW.map((c, i) => (
            <div key={c.role} className={`tm__fig${i === at ? ' on' : ''}`} style={{ ['--t' as any]: ROLES[c.role]?.t }}>
              <img className="tm__sprite" src={`/sprites/${c.role}/${c.role}-0.png`} alt={ROLE_NAME[c.role]} />
              <div className="tm__call a"><span className="mono">Buys</span><b>{c.buys}</b><span>from {c.from}</span></div>
              {c.role === 'messenger'
                ? <div className="tm__call b"><span className="mono">Paid by</span><b>The CFO</b><span>one monthly plan, not per email</span></div>
                : <div className="tm__call b"><span className="mono">Pays with</span><b>x402 · Circle Gateway</b><span>its own USDC balance on Arc</span></div>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- 02 · the CFO, on a blueprint

// Categorical colours for the five buckets, validated on the forest surface (CVD-separated, labelled too).
const BUCKETS: [string, string, string][] = [['operating', 'OPERATING', '#4B8DCF'], ['tools', 'TOOLS', '#59A53B'], ['bond', 'BOND', '#8F5FC0'], ['reserve', 'RESERVE', '#C38300'], ['promo', 'PROMO', '#04A19B']];

function Cfo({ cfo }: { cfo: Cfo | null }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const live = cfo?.snapshot?.buckets ?? null;
  const buckets = BUCKETS.map(([key, label, color]) => ({ key, label, color, value: live?.[key] ?? { operating: 1.2, tools: 0.6, bond: 1.5, reserve: 1, promo: 0.4 }[key]! }));
  const latest = cfo?.decisions.find((d) => d.status === 'done' || d.status === 'escalated');
  return (
    <section className="panel dark on-dark cf" id="cfo">
      <div className="cf__grid wrap">
        <div className="cf__copy">
          <span className="label"><span className="n">05</span>Behind the scenes · the CFO</span>
          <SplitLines text="An AI runs the money. A contract keeps it honest." accent="honest." />
          <Rv as="p" className="lede">Syncly's money lives in a vault on Arc, and an AI CFO runs it. Every few minutes it reads the vault and every agent's balance, then decides by fixed rules: it plans the week, puts revenue to work and tops up agents who run low. No language model touches the money, and every decision is signed.</Rv>
          <div className="cf__notes">
            {[
              ['Plans the week', "Each agent's allowance comes from what it actually spent per job. The plan's hash is sealed on-chain before any money moves."],
              ['Puts revenue to work', 'Tools first, then bond cover for guarantees, then the reserve. The rest stays in operating.'],
              ['Asks the Boss', 'It moves money alone only up to a limit the owner sets on the vault. Anything bigger waits for a human to co-sign on-chain.'],
            ].map(([h, p], i) => <Rv key={h} className="bracket" delay={0.1 * i}><span className="mono">→ {h}</span><p>{p}</p></Rv>)}
          </div>
        </div>
        <div className={`cf__art${seen ? ' in' : ''}`} ref={ref}>
          <div className="cf__head mono"><span>SynclyVault · Arc mainnet</span><span>{live ? 'live balances, USDC' : 'illustration · vault not in demo'}</span></div>
          <VaultArt buckets={buckets} />
          <div className="cf__foot">
            {latest ? <p><span className="mono">Latest decision · {timeAgo(latest.at)}</span>{latest.summary}</p> : <p><span className="mono">Decision log</span>The CFO's first decisions appear here once it is running.</p>}
            <div className="cf__stats mono">
              <span><b>{cfo?.metrics.done ?? 0}</b> carried out</span>
              <span><b>{cfo?.metrics.escalated ?? 0}</b> to the Boss</span>
              <span><b>{cfo?.verify.ok ? '✓' : '—'}</b> log verified</span>
            </div>
            <Link href="/docs/the-cfo" className="pill green">Read the CFO's rules <Arrow /></Link>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- 03 · how a job works, on stacking cards

const HOW = [
  { n: '01', h: 'Tell us what you need.', s: 'A short form. You see the price first.', p: <>Pick a job and answer a few questions about your business. The AI CFO prices it before anything starts, and <b>puts up a bond you receive if you reject the work</b>.</>, Art: QuoteArt },
  { n: '02', h: 'Pay $1, in naira or USDC.', s: 'Your money waits in escrow, not with us.', p: <>Pay about ₦1,400 by bank transfer or card, or 1 USDC from your wallet. The money is held by <b>a contract on Arc</b> until you accept the work.</>, Art: EscrowArt },
  { n: '03', h: 'Watch the team work.', s: 'Live, step by step, on your job page.', p: <>The agents search, read, write and design while you watch, and <b>every tool they pay for is listed</b>, linked to its payment on Arc. Most jobs take 2 to 5 minutes.</>, Art: ReceiptArt },
  { n: '04', h: 'Accept, revise, or get your money back.', s: 'You decide. Silence for 48 hours counts as yes.', p: <>Preview the work, then accept to unlock the full files, ask for <b>one free revision</b>, or reject it and <b>get your money back plus the bond</b>.</>, Art: DecideArt },
];

function HowCard({ c, i, total }: { c: (typeof HOW)[number]; i: number; total: number }) {
  const ref = useRef<HTMLLIElement>(null);
  const [inRef, seen] = useInView<HTMLDivElement>('-25% 0px -25% 0px');
  useFrame(() => {
    const el = ref.current, next = el?.nextElementSibling as HTMLElement | null;
    if (!el) return;
    if (!next || getComputedStyle(el).position !== 'sticky') { el.style.removeProperty('--c'); return; }
    const a = el.getBoundingClientRect(), b = next.getBoundingClientRect();
    el.style.setProperty('--c', (1 - clamp((b.top - a.top) / a.height)).toFixed(3));
  });
  return (
    <li className="hw__card" ref={ref} style={{ ['--k' as any]: i, zIndex: i + 1 }}>
      <div className="hw__copy">
        <span className="mono hw__n">{c.n} / 0{total}</span>
        <h3>{c.h}</h3>
        <p className="hw__s">{c.s}</p>
        <p>{c.p}</p>
      </div>
      <div className={`hw__art${seen ? ' in' : ''}`} ref={inRef}><c.Art /></div>
    </li>
  );
}

function How() {
  return (
    <section className="hw wrap" id="how">
      <div className="hw__head">
        <span className="label"><span className="n">02</span>How it works</span>
        <SplitLines text="Four steps. Pay only for work you accept." />
      </div>
      <ol className="hw__cards">{HOW.map((c, i) => <HowCard key={c.n} c={c} i={i} total={HOW.length} />)}</ol>
    </section>
  );
}

// ---------------------------------------------------------------- 02 · follow the money

const SELLERS = ['BlockRun', 'Exa', 'Serper', 'APEX', 'DataForSEO'];
const CONTRACTORS = ['scout', 'researcher', 'writer', 'illustrator', 'producer'];
const shortHash = (h?: string) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : '0x…');

/** The money's path through the company, one stop per job the treasury does, each with a live number. */
function Money({ stats, cfo }: { stats: Stats | null; cfo: Cfo | null }) {
  const latest = cfo?.decisions[0];
  const stops: { k: string; h: string; p: string; vis: ReactNode; stat: string }[] = [
    {
      k: 'Invoices', h: 'Customers pay into escrow',
      p: 'Every order is a fixed-price bill, paid into JobEscrow on Arc. Syncly is paid only when the customer accepts. A rejection refunds it, plus a bond the CFO put up.',
      vis: <span className="mf__tag">JobEscrow · Arc</span>,
      stat: `${stats?.delivered ?? '—'} jobs delivered`,
    },
    {
      k: 'Treasury', h: 'The vault splits it by rule',
      p: 'Released money lands in SynclyVault. The CFO puts it to work across five buckets, and keeps the reserve above its floor.',
      vis: <span className="mf__buckets">{BUCKETS.map(([key, label, color]) => <i key={key} title={label} style={{ background: color }} />)}<span className="mono">5 buckets</span></span>,
      stat: cfo?.snapshot?.epoch ? `Week ${cfo.snapshot.epoch}’s plan sealed on Arc` : 'A plan sealed on Arc each week',
    },
    {
      k: 'Contractors', h: 'Each agent gets an allowance',
      p: 'Ten agents, each with its own wallet and a weekly allowance set from what it really spends per job. The CFO tops them up when they run low.',
      vis: <span className="mf__faces">{CONTRACTORS.map((r) => <Avatar key={r} role={r} />)}<span className="mono">+5</span></span>,
      stat: '10 agent wallets on Arc',
    },
    {
      k: 'Payments', h: 'Agents pay suppliers per call',
      p: 'Search, AI models and checks are bought with x402 through Circle Gateway. Payout addresses are pinned and screened before anything is signed.',
      vis: <span className="mf__sellers">{SELLERS.slice(0, 3).map((x) => <span key={x}>{x}</span>)}<span>+{SELLERS.length - 3}</span></span>,
      stat: `${stats?.toolCalls ?? '—'} paid · ${stats?.settled ?? '—'} settled on Arc`,
    },
    {
      k: 'Audit trail', h: 'Every decision is signed',
      p: "Each decision is hash-chained to the one before and signed by the CFO's key, and its hash rides on the vault transaction. Anyone can replay the log.",
      vis: <span className="mf__hash mono">{shortHash(latest?.hash)}</span>,
      stat: cfo ? `${cfo.verify.entries} entries · ${cfo.verify.ok ? 'verified ✓' : 'not verified'}` : 'The decision log',
    },
  ];
  return (
    <section className="mf wrap" id="money">
      <div className="mf__head">
        <span className="label"><span className="n">06</span>Follow the money</span>
        <SplitLines text="From the invoice to the audit trail." />
        <Rv as="p" className="lede">Real businesses pay real USDC. This is the path every dollar takes through Syncly, and the rule at each step.</Rv>
      </div>
      <ol className="mf__flow">
        {stops.map((s, i) => (
          <Rv as="li" key={s.k} className="mf__stop" delay={0.06 * i}>
            <span className="mf__k"><span>{s.k}</span><span>{String(i + 1).padStart(2, '0')}</span></span>
            <div className="mf__vis">{s.vis}</div>
            <h3>{s.h}</h3>
            <p>{s.p}</p>
            <span className="mf__stat"><span className="dot" />{s.stat}</span>
          </Rv>
        ))}
      </ol>
      <Rv className="mf__bar" delay={0.2}>
        <p><b>Autonomous, inside hard limits.</b> The CFO acts alone only up to a limit the owner sets on the vault. Anything bigger is a proposal that only the owner's wallet can co-sign on Arc, and no language model ever touches the money.</p>
        <span className="mf__links">
          <a href="/api/cfo" className="pill green">The signed log <Arrow /></a>
          <Link href="/docs/the-cfo" className="pill ghost">The CFO's rules <Arrow /></Link>
        </span>
      </Rv>
      <Rv className="mf__pay" delay={0.25}>
        <span className="mf__new mono">New</span>
        <p><b>Syncly Pay.</b> The same rules, for your business's own money: invoices your customers can pay only once, to the right address, and suppliers' bills the Investigator checks before you pay.</p>
        <Link href="/pay" className="pill dark">Open Syncly Pay <Arrow /></Link>
      </Rv>
    </section>
  );
}

// ---------------------------------------------------------------- 05 · the office

function TheOffice() {
  // The office (sprites, sound, a live feed) only starts once you scroll near it; until then the cutaway is a plain picture.
  const [near, seenNear] = useInView<HTMLDivElement>('900px 0px 900px 0px');
  return (
    <section className="of" id="office">
      <div className="of__head wrap">
        <span className="label"><span className="n">08</span>The office</span>
        <SplitLines text="Watch them work. Every movement is a real event." />
      </div>
      <Rv className="of__frame">
        <div ref={near}>{seenNear ? <Office /> : <img className="of__ph" src="/scene/building-1920.webp" alt="Syncly HQ, the office where the team works" />}</div>
        <div className="of__bar mono"><span><span className="dot" />Syncly HQ · every coin is a real payment</span><span><Link href="/live">⤢ Full screen</Link> · <Link href="/office">Open the office</Link></span></div>
      </Rv>
    </section>
  );
}

// ---------------------------------------------------------------- close

const ASK: [string, string, string][] = [
  ['website', 'Website', 'A website for my small chops business, WhatsApp 0803 555 0142'],
  ['flyers', 'Flyers', 'A price list for my party trays, from ₦25,000, order on WhatsApp'],
  ['find-customers', 'Find customers', 'I’m a freelance graphic designer in Abuja. I do logos and flyers'],
  ['money-report', 'Money report', 'Where does my money go every month?'],
  ['ad-launch', 'Ads', 'Ads that bring WhatsApp orders for my small chops, ₦5,000 a day'],
]

function Close() {
  const router = useRouter();
  const [svc, setSvc] = useState(ASK[0][0]);
  const [brief, setBrief] = useState('');
  const [ref, seen] = useInView<HTMLDivElement>();
  const go = (e: FormEvent) => { e.preventDefault(); try { if (brief.trim()) sessionStorage.setItem('outlay:brief', brief.trim()); } catch {} router.push(`/hire/${svc}`); };
  return (
    <section className="panel dark on-dark cl">
      <div className="cl__grid wrap">
        <div>
          <span className="label"><span className="n">10</span>Start here</span>
          <SplitLines text="What should the team do for you?" />
          <Rv as="p" className="lede">Pick a job and say what you need in a sentence. You see the price before anything starts, and every job is $1.</Rv>
          <Rv delay={0.15}>
            <form className="cl__ask" onSubmit={go}>
              <input type="text" value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={ASK.find((a) => a[0] === svc)![2]} aria-label="What do you need done?" />
              <button type="submit" className="pill green">Get my price <Arrow /></button>
            </form>
            <div className="cl__chips">{ASK.map(([id, label]) => <button type="button" key={id} className={`chip click dark${svc === id ? ' on' : ''}`} onClick={() => setSvc(id)}>{label}</button>)}</div>
            <p className="mono cl__fine">$1 a job · pay in naira or USDC · only if you accept · refund + bond if you reject</p>
          </Rv>
        </div>
        <div className={`cl__art${seen ? ' in' : ''}`} ref={ref}><MarkBlock /></div>
      </div>
    </section>
  );
}

export default function Home() {
  const { data: svc } = useApi<{ services: Service[] }>('/api/services');
  const { data: stats } = useApi<Stats>('/api/stats', 20000);
  const { data: team } = useApi<{ agents: Record<string, AgentStats> }>('/api/team', 30000);
  const { data: cfo } = useApi<Cfo>('/api/cfo', 30000);
  return (
    <main className="home">
      <Hero stats={stats} />
      {svc && <WhatWeDo services={svc.services} />}
      <How />
      <RealWork stats={stats} />
      <PayYourWay />
      <Cfo cfo={cfo?.enabled ? cfo : null} />
      <Money stats={stats} cfo={cfo?.enabled ? cfo : null} />
      <Team agents={team?.agents ?? {}} />
      <TheOffice />
      <Questions />
      <Close />
    </main>
  );
}
