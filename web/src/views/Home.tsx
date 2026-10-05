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

type Stats = { mode: 'demo' | 'live'; toolCalls: number; settled: number; delivered: number; customers: number };
type Cfo = { enabled: boolean; mode: string; metrics: { done: number; escalated: number }; verify: { ok: boolean; entries: number }; snapshot: null | { buckets: Record<string, number>; epoch?: number }; decisions: { summary: string; at: string; tx?: string; status: string; kind: string; hash?: string }[] };

const Arrow = () => <span className="pill__ic">→</span>;

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
          <SplitLines as="h1" text="AI agents do the work. An AI CFO runs the money." />
          <Rv as="p" delay={0.35}>
            <span className="hx__long">Syncly is a real business staffed by AI agents. Small businesses hire them for websites, ads and research from 1 USDC a job. The CFO prices every job, pays every agent and supplier in USDC on Arc, and signs every decision, inside limits a smart contract enforces.</span>
            <span className="hx__short">A real business staffed by AI agents, hired from 1 USDC a job. The CFO pays every agent and supplier in USDC on Arc, inside limits a smart contract enforces.</span>
          </Rv>
          <Rv className="hx__cta" delay={0.5}>
            <Link href="/#services" className="pill white lg">Hire the team <Arrow /></Link>
            <Link href="/#money" className="pill ghost lg">Follow the money <Arrow /></Link>
          </Rv>
        </div>
        <div className="hx__foot mono"><span>Every payment settles on Arc · every decision signed · 1–2 USDC a job</span><span>Scroll ↓</span></div>
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
          <span className="label"><span className="n">03</span>The team</span>
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
          <span className="label"><span className="n">01</span>The CFO</span>
          <SplitLines text="An AI runs the money. A contract keeps it honest." accent="honest." />
          <Rv as="p" className="lede">Syncly's money lives in a vault on Arc, and an AI CFO runs it. Every few minutes it reads the vault and every agent's balance, then decides by fixed rules: it plans the week, puts revenue to work and tops up agents who run low. No language model touches the money, and every decision is signed.</Rv>
          <div className="cf__notes">
            {[
              ['Plans the week', "Each agent's allowance comes from what it actually spent per job. The plan's hash is sealed on-chain before any money moves."],
              ['Puts revenue to work', 'Tools first, then bond cover for guarantees, then the reserve. The rest stays in operating.'],
              ['Asks the Boss', 'It moves at most 2 USDC a week between two buckets alone. Anything bigger waits for a human to co-sign on-chain.'],
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
  { n: '01', h: 'You ask. The CFO prices it.', s: 'A fixed price before anything starts.', p: <>Describe the job in a sentence. The CFO prices it from what similar jobs really cost, and puts up <b>a bond you receive if you reject the work</b>. You only pay if you accept.</>, Art: QuoteArt },
  { n: '02', h: 'You pay into escrow.', s: 'The money waits in a contract, not with us.', p: <>Pay in USDC from your own wallet into <b>JobEscrow on Arc</b>. Syncly is paid only when you accept, or after 48 hours of silence.</>, Art: EscrowArt },
  { n: '03', h: 'You watch them work.', s: 'Every call they make is on your job page.', p: <>The agents buy searches, page reads and model calls with x402 nanopayments, <b>each one linked to its settlement on Arc</b>. You watch it happen, step by step.</>, Art: ReceiptArt },
  { n: '04', h: 'You decide.', s: 'Accept, revise once, or reject.', p: <>Only the wallet that paid can decide. Accept to release the payment, ask for one free revision, or reject it and <b>get your money back plus the bond</b>.</>, Art: DecideArt },
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
        <span className="label"><span className="n">04</span>How a job works</span>
        <SplitLines text="Pay only for work you accept." />
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
        <span className="label"><span className="n">02</span>Follow the money</span>
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
        <p><b>Autonomous, inside hard limits.</b> The CFO acts alone up to 2 USDC a move. Anything bigger is a proposal that only the owner's wallet can co-sign on Arc, and no language model ever touches the money.</p>
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
        <span className="label"><span className="n">05</span>The office</span>
        <SplitLines text="Watch them work. Every movement is a real event." />
      </div>
      <Rv className="of__frame">
        <div ref={near}>{seenNear ? <Office /> : <img className="of__ph" src="/scene/building-1920.webp" alt="Syncly HQ, the office where the team works" />}</div>
        <div className="of__bar mono"><span><span className="dot" />Syncly HQ · every coin is a real payment</span><span><Link href="/live">⤢ Full screen</Link> · <Link href="/office">Open the office</Link></span></div>
      </Rv>
    </section>
  );
}

// ---------------------------------------------------------------- 06 · services, on a pinned index

function Services({ services }: { services: Service[] }) {
  const ref = useRef<HTMLElement>(null);
  const list = [...services].sort((a, b) => Number(b.live) - Number(a.live));
  const [at, setAt] = useState(0);
  useStickyProgress(ref, (p) => setAt(Math.min(list.length - 1, Math.floor(p * list.length))));
  // This section appears once the services load, after the browser has already tried to jump to #services.
  useEffect(() => { if (location.hash === '#services') ref.current?.scrollIntoView({ block: 'start' }); }, []);
  const s = list[at];
  return (
    <section className="sv" id="services" ref={ref} style={{ ['--n' as any]: list.length }}>
      <div className="sv__stick wrap">
        <div className="sv__card" style={{ ['--t' as any]: s ? DEPT_TINT[s.dept] ?? '#EEF3F1' : undefined }}>
          <span className="sv__count mono">{String(at + 1).padStart(2, '0')} / {String(list.length).padStart(2, '0')}</span>
          <div className="sv__team">{s?.team.filter((r) => ROLES[r] && r !== 'messenger').slice(0, 4).map((r, i) => <img key={s.id + r} src={`/sprites/${r}/${r}-0.png`} alt={ROLE_NAME[r]} style={{ ['--i' as any]: i }} />)}</div>
          <div className="sv__bar">
            <div><span className="mono">{s?.dept}</span><b>{s?.tagline}</b></div>
            {s?.live ? <Link className="pill dark" href={`/hire/${s.id}`}>Hire <Arrow /></Link> : <span className="chip">Coming soon</span>}
          </div>
        </div>
        <div className="sv__list">
          <span className="label"><span className="n">06</span>Services</span>
          <ol>
            {list.map((x, i) => (
              <li key={x.id} className={`${i === at ? 'on' : ''}${x.live ? '' : ' soon'}`}>
                <span className="mono sv__i">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <h3>{x.name}</h3>
                  <div className="sv__more"><div>
                    <p>{x.tagline}</p>
                    <span className="mono">{x.live ? `${x.priceUsd} USDC · about ${x.etaMin} min` : 'coming soon'}</span>
                  </div></div>
                </div>
                {x.live && <Link href={`/hire/${x.id}`} className="sv__go" aria-label={`Hire for ${x.name}`}>→</Link>}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- close

const ASK: [string, string, string][] = [
  ['website', 'Website', 'A site for my small chops business, WhatsApp 0803 555 0142'],
  ['ad-launch', 'Run ads', 'Ads that bring WhatsApp orders for my small chops, ₦5,000 a day'],
  ['product-photos', 'Product photos', 'Studio photos of my shea butter jars for Instagram and Jumia'],
  ['get-found', 'Get found', 'Why don’t I show up when people search “small chops Surulere”?'],
  ['buy-smart', 'Buy smart', 'Two chest freezers delivered to Surulere, cheapest from a seller I can trust'],
];

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
          <span className="label"><span className="n">07</span>Start here</span>
          <SplitLines text="Your website, live today." />
          <Rv as="p" className="lede">Tell the team what you need in a sentence. You see the price and the bond before anything starts.</Rv>
          <Rv delay={0.15}>
            <form className="cl__ask" onSubmit={go}>
              <input type="text" value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={ASK.find((a) => a[0] === svc)![2]} aria-label="What do you need done?" />
              <button type="submit" className="pill green">Get a free quote <Arrow /></button>
            </form>
            <div className="cl__chips">{ASK.map(([id, label]) => <button type="button" key={id} className={`chip click dark${svc === id ? ' on' : ''}`} onClick={() => setSvc(id)}>{label}</button>)}</div>
            <p className="mono cl__fine">1–2 USDC a job, no card · pay only if you accept · refund + bond if you reject</p>
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
      <Cfo cfo={cfo?.enabled ? cfo : null} />
      <Money stats={stats} cfo={cfo?.enabled ? cfo : null} />
      <Team agents={team?.agents ?? {}} />
      <How />
      <TheOffice />
      {svc && <Services services={svc.services} />}
      <Close />
    </main>
  );
}
