// Get Found: can customers find a local business on Google Maps and in ChatGPT, Gemini, Claude and
// Perplexity, and what to fix. Researcher parses the brief (the order form's values win) → Scout reads the
// Google Maps link (free), finds the listing (Serper Maps) and its full Business Profile (DataForSEO) →
// Reader reads the business's own site (APEX). Then two lanes at once:
//  (a) the AI Answer Audit, run as a step: Investigator and Researcher put 5 customer questions (plus the
//      owner's own) to the 4 assistants with web search on; Analyst checks every statement against the
//      record; code checks every quote word for word; Auditor (other model family) re-judges blind and a
//      statement counts as wrong only when both agree.
//  (b) Scout searches Google Maps for what customers type, from a 3×3 grid of spots 1.5 km apart around the
//      listing (Serper Maps with a map centre), then pulls the newest and the lowest-rated reviews → Analyst
//      (code) ranks every spot, finds who shows above the business, and runs the profile-gap rules → Writer
//      drafts a profile description and review replies from the record only → code checks length, links
//      and every number; Auditor checks them for promises and invented facts; failures get one rewrite.
// → the grid picture is rendered in headless Chrome → Writer summarises (numbers checked against the data)
// → one fix list merged from the Maps, profile and AI rules, ranked in code.
import { Job } from '../job.ts';
import { DRY, MODELS } from '../config.ts';
import { HOSTS, llm, parseJson } from '../tools.ts';
import { AISA, ortho } from '../sellers.ts';
import { SpendRefused } from '../x402.ts';
import { htmlToPng } from '../browser.ts';
import { researchInto } from './research-brief.ts';
import { MAIL_BUDGET_USD, MAIL_HOST } from '../mail.ts';
import type { BusinessDetails } from '../details.ts';
import { e164 } from '../site/facts.ts';
import {
  addOwnerFacts, auditAnswers, cell, csvCell, errMsg, gatherTruth, GENERIC, hostOf, nameScore, nOf, place, plain, readSpec, recordText, shortHours, today, uniq, words,
  type AuditResult, type Fix, type Kind, type MapsHints, type Spec, type Truth,
} from './ai-answer-audit.ts';
import * as fx from './get-found.fixtures.ts';

type Pt = { row: number; col: number; label: string; lat?: number; lng?: number };
type Listing = { key: string; title: string; cid?: string; position: number; rating?: number; reviews?: number; category?: string; types: string[]; website?: string; hours: boolean };
type Cell = { pt: Pt; rank?: number; of: number; all: Listing[]; above: Listing[]; error?: string };
type Search = { q: string; cells: Cell[] };
type Rival = { key: string; title: string; above: number; seen: number; sum: number; best: number; last: Listing; named?: string };
type Review = { id: string; key: string; rating: number; when: string; iso?: string; text: string; who: string; replied: boolean };
type Draft = { review: Review; reply: string; rewritten?: boolean; dropped?: string };
type Gap = { item: string; shows: string; ok?: boolean; fix?: string; rank?: number; long?: string };

// The AI part asks 5 questions (3 by name, 2 for a recommendation) instead of the audit's 6: the Maps grid
// now shows who gets recommended from Google's side. The owner's own question is still asked.
const KINDS: Kind[] = ['hours', 'status', 'price', 'best', 'service'];
const STEP_KM = 1.5;
const ZOOM = 15;
const LABEL = [['north-west', 'north', 'north-east'], ['west', 'middle', 'east'], ['south-west', 'south', 'south-east']];
const MAX_DESC = 750; // Google's limit for a Business Profile description
// Where each AI fix lands in the merged list; null = Get Found's own Maps/profile rules cover it
const AI_RANK: Record<string, number | null> = { listing: null, claim: null, status: 1, hours: 3, conflict: 3, contact: 4, reviews: 6, prices: 7, website: 8.5, basics: 9, sources: 9 };

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);
const fmt = (n?: number) => (n === undefined ? '—' : n.toLocaleString('en-US'));
const stars = (n?: number) => (n === undefined ? '—' : n.toFixed(1));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const squash = (s: string) => plain(s).replace(/[^a-z0-9]/g, '');
const first = (name: string) => name.trim().split(/\s+/)[0] || 'there';
const many = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`;
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const human = (a: string) => a.replace(/^(has|serves|offers|is|pay|accepts)_/, '').replace(/_/g, ' ');
const flat = (o: any): string[] => (o && typeof o === 'object' ? Object.values(o).flatMap((v) => (Array.isArray(v) ? v.map(String) : [])) : []);
/** Numbers in `text` that do not appear in `sources` (commas ignored): the "no invented numbers" check. */
const strayNumbers = (text: string, sources: string) => {
  const src = sources.replace(/,/g, '');
  return uniq((text.match(/\d[\d,.:]*\d|\d/g) ?? []).map((n) => n.replace(/[.,:]+$/, '')).filter((n) => !sources.includes(n) && !src.includes(n.replace(/,/g, ''))));
};
const PROMISE = /\b(refunds?|money back|reimburs\w*|discounts?|vouchers?|coupons?|compensat\w*|on us|on the house|free (?:of charge|meals?|plates?|food|drinks?|delivery|items?|dishes?|service))\b|%\s?off/i;
const LINK = /https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|ng|net|org|co|io|shop|store|biz|info|me)\b/i;
const EMOJI = /\p{Extended_Pictographic}/u;
const FOOD = /restaurant|food|cafe|café|bakery|kitchen|bar\b|grill|eatery|cater|buka|lounge|suya|chops/i;

// ---------- 1. what we know before paying: the Maps link and the searches

/** A Google Maps link → its cid, pin and place name. Short share links are followed once (a free request). */
async function mapsHints(link?: string): Promise<MapsHints> {
  if (!link) return {};
  let url = link;
  if (/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl)\//i.test(url) && !DRY) {
    try { url = (await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) })).headers.get('location') ?? url; } catch { /* keep the short link */ }
  }
  let u = url;
  try { u = decodeURIComponent(url); } catch { /* keep it raw */ }
  const h: MapsHints = {};
  const pin = u.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) ?? u.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (pin) { h.lat = Number(pin[1]); h.lng = Number(pin[2]); }
  const cid = u.match(/[?&](?:cid|ludocid)=(\d{5,})/)?.[1];
  const fid = u.match(/0x[0-9a-f]+:0x([0-9a-f]+)/i)?.[1];
  if (cid) h.cid = cid;
  else if (fid) try { h.cid = BigInt(`0x${fid}`).toString(); } catch { /* not a feature id */ }
  const name = u.match(/\/place\/([^/@?]+)/)?.[1]?.replace(/\+/g, ' ').trim();
  if (name) h.name = name;
  return h;
}

/** At most 2 searches: what the owner says customers type, else "<category> in <area>" and "<service> near me". */
function searchesFor(spec: Spec, d?: BusinessDetails, parsed?: unknown): string[] {
  const split = (s: string) => s.split(/[,;\n]|\s+\/\s+|\s+or\s+/i).map((x) => x.replace(/["“”‘’]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)).filter((x) => x.length >= 3);
  const own = d?.searches ? split(d.searches) : Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').flatMap(split) : [];
  const derived = [`${spec.category} in ${spec.area || spec.city}`, `${plain(spec.service) === plain(spec.category) ? spec.categoryPlural : spec.service} near me`];
  const out: string[] = [];
  for (const q of [...own, ...derived]) if (!out.some((x) => plain(x) === plain(q))) out.push(q);
  return out.slice(0, 2);
}

// ---------- 2. the Maps grid

function gridPoints(lat: number, lng: number): Pt[] {
  const dLat = STEP_KM / 110.574, dLng = STEP_KM / (111.32 * Math.cos((lat * Math.PI) / 180));
  return LABEL.flatMap((r, row) => r.map((label, col) => ({ row, col, label, lat: lat + (1 - row) * dLat, lng: lng + (col - 1) * dLng })));
}

async function searchAt(job: Job, spec: Spec, q: string, pt: Pt, si: number, pi: number): Promise<Listing[]> {
  const ll = pt.lat !== undefined && pt.lng !== undefined ? `@${pt.lat.toFixed(6)},${pt.lng.toFixed(6)},${ZOOM}z` : undefined;
  const data = await ortho<any>(job, 'serper/maps', { body: { q, gl: spec.countryIso.toLowerCase() || undefined, ...(ll ? { ll } : {}) } }, {
    agent: 'scout', vendor: 'Serper Maps (Orthogonal)', reason: `Maps rank check: "${q}" from the ${pt.label}`, expectUsd: 0.006, maxUsd: 0.01, dry: () => fx.grid(si, pi),
  });
  return (data?.places ?? []).filter((p: any) => p?.title).map((p: any, i: number) => {
    const oh = p.openingHours;
    return {
      key: p.cid ? `cid:${p.cid}` : `name:${squash(p.title)}`, title: String(p.title), cid: p.cid ? String(p.cid) : undefined, position: i + 1,
      rating: num(p.rating), reviews: num(p.ratingCount), category: p.type ?? p.category, types: Array.isArray(p.types) ? p.types.map(String) : [],
      website: p.website || undefined, hours: typeof oh === 'string' ? !!oh.trim() : !!oh && typeof oh === 'object' && Object.keys(oh).length > 0,
    };
  });
}

/** Every search from every spot. Two failures before any success means the seller is down: stop paying. */
async function runGrid(job: Job, spec: Spec, searches: string[], center: { lat: number; lng: number } | undefined, isUs: (l: Listing) => boolean): Promise<Search[]> {
  const pts = center ? gridPoints(center.lat, center.lng) : [{ row: 0, col: 0, label: spec.area || spec.city }];
  const out: Search[] = [];
  let ok = 0, fails = 0, down = '';
  for (const [si, q0] of searches.entries()) {
    // with no pin, "near me" would mean near Serper's servers: search the area by name instead
    const q = center ? q0 : q0.replace(/\bnear me\b/i, `in ${spec.area || spec.city}`);
    job.log('scout', 'grid', center ? `"${q}" from ${pts.length} spots ${STEP_KM} km apart around the listing` : `"${q}" once for the area (no map pin for the business)`);
    const cells: Cell[] = [];
    for (const [pi, pt] of pts.entries()) {
      if (down) { cells.push({ pt, of: 0, all: [], above: [], error: `not searched: ${down}` }); continue; }
      try {
        const all = await searchAt(job, spec, q, pt, si, pi);
        const k = all.findIndex(isUs);
        cells.push({ pt, rank: k >= 0 ? k + 1 : undefined, of: all.length, all, above: (k >= 0 ? all.slice(0, k) : all).filter((l) => !isUs(l)) });
        ok++;
      } catch (e) {
        if (e instanceof SpendRefused) down = 'the job budget is spent';
        else if (!ok && ++fails >= 2) down = 'Maps failed twice in a row, so we stopped paying for it';
        cells.push({ pt, of: 0, all: [], above: [], error: errMsg(e).slice(0, 80) });
        job.log('scout', 'skip', `"${q}" from the ${pt.label}: ${errMsg(e).slice(0, 70)}`);
      }
    }
    out.push({ q, cells });
  }
  return out;
}

/** Everyone who showed up, with how often they were above the business. */
function rivalsOf(grid: Search[], isUs: (l: Listing) => boolean): Rival[] {
  const m = new Map<string, Rival>();
  for (const s of grid) for (const c of s.cells) {
    for (const l of c.all) {
      if (isUs(l)) continue;
      const r = m.get(l.key) ?? { key: l.key, title: l.title, above: 0, seen: 0, sum: 0, best: 99, last: l };
      r.seen++; r.sum += l.position; r.best = Math.min(r.best, l.position); r.last = l;
      m.set(l.key, r);
    }
    for (const l of c.above) m.get(l.key)!.above++;
  }
  return [...m.values()].sort((a, b) => b.above - a.above || a.sum / a.seen - b.sum / b.seen);
}

const searched = (s: Search) => s.cells.filter((c) => !c.error);
const stats = (s: Search) => {
  const ok = searched(s), found = ok.filter((c) => c.rank);
  return { n: ok.length, found: found.length, top3: found.filter((c) => c.rank! <= 3).length, top10: found.filter((c) => c.rank! <= 10).length, best: found.length ? Math.min(...found.map((c) => c.rank!)) : undefined, missing: ok.length - found.length };
};
const cellText = (c: Cell) => (c.error ? '?' : c.rank ? String(c.rank) : `>${c.of}`);

// The picture: one 3×3 panel per search, ranks coloured by band (light theme, rendered on our server)
function band(c: Cell): [string, string] {
  if (c.error) return ['#D5D8DD', '#3F444B'];
  if (!c.rank) return ['#C9443A', '#FFFFFF'];
  return c.rank <= 3 ? ['#2E9E5B', '#FFFFFF'] : c.rank <= 10 ? ['#F2B33D', '#3A2A00'] : ['#E2702E', '#FFFFFF'];
}
function gridHtml(spec: Spec, grid: Search[]): { html: string; w: number; h: number } {
  const panels = grid.filter((s) => s.cells.length === 9);
  const w = 96 + panels.length * 480 + (panels.length - 1) * 40, h = 760;
  const short = ['NW', 'N', 'NE', 'W', '', 'E', 'SW', 'S', 'SE'];
  const panel = (s: Search) => {
    const st = stats(s);
    return `<section><h2>“${esc(s.q)}”</h2><p class="st">Top 3 at <b>${st.top3} of ${st.n}</b> spots · in the results at ${st.found} of ${st.n}</p><div class="g">${s.cells.map((c, i) => {
      const [bg, fg] = band(c);
      return `<div class="c" style="background:${bg};color:${fg}"><i>${short[i]}</i><b>${esc(cellText(c))}</b>${i === 4 ? '<u>your listing</u>' : ''}</div>`;
    }).join('')}</div></section>`;
  };
  const key = [['#2E9E5B', 'Top 3'], ['#F2B33D', '4–10'], ['#E2702E', '11 or lower'], ['#C9443A', 'Not in the results'], ...(grid.some((s) => s.cells.some((c) => c.error)) ? [['#D5D8DD', 'Search failed']] : [])];
  const html = `<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=block" rel="stylesheet"><style>
*{box-sizing:border-box;margin:0}html,body{width:${w}px;height:${h}px;background:#F7F6F2}body{padding:44px 48px;font-family:Geist,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#17181A}
h1{font-size:32px;font-weight:700;letter-spacing:-.02em}.sub{margin-top:8px;font-size:17px;color:#5E636B}.row{display:flex;gap:40px;margin-top:34px}
section{width:480px;background:#fff;border-radius:22px;padding:22px 6px 6px;box-shadow:0 1px 2px rgba(0,0,0,.06),0 8px 24px rgba(0,0,0,.05)}
h2{font-size:21px;font-weight:600;padding:0 16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.st{font-size:15px;color:#5E636B;padding:6px 16px 16px}
.g{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:0 10px 10px}.c{position:relative;height:132px;border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center}
.c b{font-size:50px;font-weight:700;letter-spacing:-.03em;line-height:1}.c i{position:absolute;top:9px;left:12px;font-style:normal;font-size:12px;font-weight:600;opacity:.75}.c u{text-decoration:none;font-size:13px;font-weight:600;margin-top:6px;opacity:.9}
.k{display:flex;gap:22px;margin-top:28px;font-size:15px;color:#3F444B;align-items:center;flex-wrap:wrap}.k span{display:inline-flex;align-items:center;gap:8px}.k s{display:inline-block;width:16px;height:16px;border-radius:5px}
</style></head><body><h1>${esc(spec.name)} on Google Maps</h1><p class="sub">Your position when a customer searches from 9 spots ${STEP_KM} km apart around your listing · ${today()}</p>
<div class="row">${panels.map(panel).join('')}</div><div class="k">${key.map(([c, t]) => `<span><s style="background:${c}"></s>${t}</span>`).join('')}</div></body></html>`;
  return { html, w, h };
}

// ---------- 3. reviews and the texts to paste

async function readReviews(job: Job, spec: Spec, cid: string): Promise<Review[]> {
  const out = new Map<string, Review>();
  for (const sortBy of ['newest', 'lowestRating']) {
    try {
      const data = await ortho<any>(job, 'serper/reviews', { body: { cid, sortBy, gl: spec.countryIso.toLowerCase() || undefined } }, {
        agent: 'scout', vendor: 'Serper Reviews (Orthogonal)', reason: `${spec.name}'s ${sortBy === 'newest' ? 'newest' : 'lowest-rated'} Google reviews`, expectUsd: 0.002, maxUsd: 0.005, dry: () => fx.reviews(sortBy),
      });
      for (const r of data?.reviews ?? []) {
        const text = String(r?.snippet ?? r?.text ?? '').replace(/\s+/g, ' ').trim();
        const rating = Number(r?.rating);
        const key = String(r?.id ?? `${r?.user?.name ?? ''}|${text.slice(0, 50)}`);
        if (!text || !(rating >= 1 && rating <= 5) || out.has(key)) continue;
        const reply = r?.response?.snippet ?? r?.response?.text ?? (typeof r?.response === 'string' ? r.response : undefined);
        out.set(key, { id: `r${out.size + 1}`, key, rating, when: String(r?.date ?? ''), iso: r?.isoDate, text: text.slice(0, 700), who: String(r?.user?.name ?? 'a customer'), replied: !!reply });
      }
    } catch (e) { job.log('scout', 'skip', `${sortBy} reviews failed (${errMsg(e).slice(0, 60)})`); }
  }
  return [...out.values()];
}

/** Up to 5 to answer: recent complaints first (at most 4), then recent praise, then older complaints. */
function pickReviews(all: Review[]): Review[] {
  const now = Date.now();
  const old = (r: Review) => (r.iso && Date.parse(r.iso) ? (now - Date.parse(r.iso)) / 864e5 > 365 : /year/i.test(r.when));
  const open = all.filter((r) => !r.replied && r.text.length >= 15).sort((a, b) => (Date.parse(b.iso ?? '') || 0) - (Date.parse(a.iso ?? '') || 0));
  const neg = open.filter((r) => r.rating <= 3 && !old(r)).slice(0, 4);
  return [...neg, ...open.filter((r) => r.rating >= 4), ...open.filter((r) => r.rating <= 3 && !neg.includes(r))].slice(0, 5);
}

function descriptionIssues(t: string, sources: string): string[] {
  const out: string[] = [];
  if (t.length > MAX_DESC) out.push(`${t.length} characters; Google allows ${MAX_DESC}`);
  if (t.length < 150) out.push('too short to be useful');
  if (LINK.test(t)) out.push('contains a web address');
  if (/\+?\d[\d\s-]{7,}\d/.test(t)) out.push('contains a phone number');
  if (/₦|\bNGN\b|naira|[$£€]\s?\d|\bN\d/i.test(t)) out.push('mentions a price');
  if (PROMISE.test(t) || /\b(sales?|promos?|promotions?|cheapest)\b/i.test(t)) out.push('promotional wording');
  if (EMOJI.test(t)) out.push('contains an emoji');
  const stray = strayNumbers(t, sources);
  if (stray.length) out.push(`numbers not in your record: ${stray.join(', ')}`);
  return out;
}

function replyIssues(t: string, rv: Review, sources: string): string[] {
  const out: string[] = [];
  if (t.length < 20) out.push('too short');
  if (t.length > 700) out.push(`${t.length} characters; keep it under 700`);
  const p = t.match(PROMISE);
  if (p) out.push(`promises something ("${p[0]}")`);
  if (LINK.test(t)) out.push('contains a web address');
  if (EMOJI.test(t)) out.push('contains an emoji');
  const stray = strayNumbers(t, `${sources}\n${rv.text}`);
  if (stray.length) out.push(`numbers not in your record or the review: ${stray.join(', ')}`);
  const last = rv.who.trim().split(/\s+/).slice(1).join(' ').replace(/\.$/, '');
  if (last.length > 2 && plain(t).includes(plain(last))) out.push('uses the reviewer\'s full name');
  return out;
}

/** A safe description built in code from the record, for when the written one fails its checks twice. */
function plainDescription(spec: Spec, truth: Truth, d: BusinessDetails | undefined, where: string, sources: string): string {
  const street = truth.address?.split(',')[0]?.trim();
  const c0 = truth.category ?? spec.category;
  const cat = /^[A-Z][a-z]+(an|ese|ish|i)\b/.test(c0) ? c0 : c0.replace(/^./, (c) => c.toLowerCase()); // "Nigerian restaurant", "hair salon"
  const s = [`${spec.name} is ${/^[aeiou]/i.test(cat) ? 'an' : 'a'} ${cat} in ${where}${street && /\d/.test(street) ? `, at ${street}` : ''}.`];
  if (d?.offer) s.push(`We offer ${d.offer.replace(/[.\s]+$/, '').replace(/^./, (c) => c.toLowerCase())}.`);
  for (const f of truth.siteFacts.filter((x) => ['service', 'menu', 'delivery'].includes(x.field)).slice(0, 4)) s.push(`${f.value.replace(/[.\s]+$/, '')}.`);
  if (truth.topics.length) s.push(`Customers often mention ${list(truth.topics.slice(0, 3))} in their reviews.`);
  const out: string[] = [];
  for (const x of s) if (!descriptionIssues(`${x} ${'x'.repeat(150)}`, sources).length && [...out, x].join(' ').length <= MAX_DESC) out.push(x);
  return out.join(' ');
}

type Paste = { desc: string; descFrom: 'writer' | 'rewrite' | 'record'; picked: number; drafts: Draft[]; audited: boolean; notes: string[] };

async function pasteReady(job: Job, spec: Spec, truth: Truth, d: BusinessDetails | undefined, where: string, sources: string, picked: Review[]): Promise<Paste> {
  const contact = d?.whatsapp ?? d?.phone ?? truth.phones[0];
  const notes: string[] = [];

  // The profile description, in the owner's voice, from the record only
  job.log('writer', 'description', `Google profile description (at most ${MAX_DESC} characters, facts from the record only)`);
  const descSystem = `You write the "From the business" description for a Google Business Profile, in the owner's voice ("we"). At most ${MAX_DESC} characters (aim for 450-700). The first 250 characters say what the business is, where it is, and what it is known for; then what it sells, how customers get it (eat in, delivery, booking: only if the sources say so) and who it is for. Use only facts in the SOURCES: no number, product, award, year or claim that is not there. No links, no phone numbers, no prices, no deals or promotions, no superlatives like "best", no emoji, no hashtags, no lists of keywords. Plain, warm and specific. Reply with the description only.`;
  let desc = '';
  let descFrom: Paste['descFrom'] = 'writer';
  try { desc = (await llm(job, 'writer', [{ role: 'system', content: descSystem }, { role: 'user', content: `SOURCES\n${sources}` }], 'write the Google profile description', { maxTokens: 600, dry: fx.description })).trim().replace(/^"|"$/g, ''); }
  catch (e) { job.log('writer', 'skip', `description failed (${errMsg(e).slice(0, 50)})`); }

  // Replies to the picked reviews
  let drafts: Draft[] = [];
  if (picked.length) {
    job.log('writer', 'replies', `replies to ${nOf(picked.length, 'review')} (${picked.filter((r) => r.rating <= 3).length} with 3 stars or fewer)`);
    const replySystem = `You write replies to Google reviews for ${spec.name}, a ${spec.category} in ${where}, in the owner's voice: warm, plain and short (2-4 sentences, under 80 words), "we". Use the reviewer's first name only. For a complaint: thank them, say sorry for the specific problem without arguing or blaming them, and invite them to get in touch directly${contact ? ` on ${contact}` : ''}; only say what the business does or will do if the RECORD says so. For praise: thank them for the specific thing they liked and invite them back. Never promise a refund, discount, free food or item, voucher or any compensation. Never state a fact, price, time or number that is not in the RECORD or the review. No links, no emoji, no hashtags. Reply JSON only: {"replies":[{"id","reply"}]}, one per review.`;
    const asks = picked.map((r) => ({ id: r.id, key: r.key }));
    try {
      const out = parseJson<{ replies?: { id: string; reply: string }[] }>(await llm(job, 'writer', [
        { role: 'system', content: replySystem },
        { role: 'user', content: `RECORD\n${sources}\n\nREVIEWS\n${JSON.stringify(picked.map((r) => ({ id: r.id, stars: r.rating, when: r.when, first_name: first(r.who), review: r.text })))}` },
      ], `draft replies to ${picked.length} reviews`, { maxTokens: 1500, json: true, dry: () => JSON.stringify(fx.replies(asks)) }), {});
      drafts = picked.map((review) => ({ review, reply: String(out.replies?.find((x) => x?.id === review.id)?.reply ?? '').trim() })).filter((x) => x.reply);
    } catch (e) { job.log('writer', 'skip', `replies failed (${errMsg(e).slice(0, 50)})`); }
  }

  // Checks: code first (length, links, promises, every number), then the auditor on another model family
  type Item = { id: string; text: string; review?: Review };
  const items = (): Item[] => [...(desc ? [{ id: 'description', text: desc }] : []), ...drafts.filter((x) => !x.dropped).map((x) => ({ id: x.review.id, text: x.reply, review: x.review }))];
  const codeIssues = (i: Item) => (i.review ? replyIssues(i.text, i.review, sources) : descriptionIssues(i.text, sources));
  let audited = true;
  const auditor = async (xs: Item[], round: number): Promise<Map<string, string[]>> => {
    const m = new Map<string, string[]>();
    if (!xs.length) return m;
    job.log('auditor', 'check', `${nOf(xs.length, 'text')} to post on Google: promises, invented facts, tone (${MODELS.auditor})`);
    try {
      const out = parseJson<{ checks?: { id: string; ok?: boolean; issues?: string[] }[] }>(await llm(job, 'auditor', [
        { role: 'system', content: 'You check texts a small business will post on Google: a profile description and replies to customer reviews. For each item flag: any fact, number, product, time or claim the SOURCES (the record, and for a reply its review) do not support; any promise of a refund, discount, free item, voucher or compensation; arguing with or blaming the customer; private information; for the description, any link, phone number, price or promotion. Reply JSON only: {"checks":[{"id","ok": true|false,"issues":[short strings]}]}, one per item.' },
        { role: 'user', content: `SOURCES (the record)\n${sources}\n\nITEMS\n${JSON.stringify(xs.map((i) => ({ id: i.id, kind: i.review ? 'review reply' : 'profile description', ...(i.review ? { review: i.review.text, stars: i.review.rating } : {}), text: i.text })))}` },
      ], `check ${xs.length} texts before they are posted${round > 1 ? ' (rewrites)' : ''}`, { model: MODELS.auditor, maxTokens: 1200, json: true, dry: () => JSON.stringify(fx.check(xs)) }), {});
      for (const c of out.checks ?? []) if (c?.ok === false) m.set(String(c.id), (c.issues ?? []).map(String).filter(Boolean).slice(0, 3));
      if (!out.checks?.length) audited = false;
    } catch (e) { audited = false; job.log('auditor', 'skip', `check failed (${errMsg(e).slice(0, 60)})`); }
    return m;
  };
  const failing = async (xs: Item[], round: number) => {
    const aud = await auditor(xs, round);
    return new Map(xs.map((i) => [i.id, [...codeIssues(i), ...(aud.get(i.id) ?? [])]] as const).filter(([, v]) => v.length));
  };

  let bad = await failing(items(), 1);
  if (bad.size) {
    job.log('writer', 'revise', `${nOf(bad.size, 'text')} failed a check: ${[...bad.entries()].map(([id, v]) => `${id}: ${v[0]}`).join('; ').slice(0, 160)}`);
    const redo: Item[] = [];
    if (bad.has('description')) {
      try {
        desc = (await llm(job, 'writer', [{ role: 'system', content: descSystem }, { role: 'user', content: `SOURCES\n${sources}` }, { role: 'assistant', content: desc },
          { role: 'user', content: `Fix these problems and reply with the corrected description only:\n- ${bad.get('description')!.join('\n- ')}` }], 'rewrite the description', { maxTokens: 600, dry: fx.description })).trim().replace(/^"|"$/g, '');
        descFrom = 'rewrite';
        redo.push({ id: 'description', text: desc });
      } catch (e) { job.log('writer', 'skip', `rewrite failed (${errMsg(e).slice(0, 50)})`); }
    }
    const again = drafts.filter((x) => bad.has(x.review.id));
    if (again.length) {
      try {
        const out = parseJson<{ replies?: { id: string; reply: string }[] }>(await llm(job, 'writer', [
          { role: 'system', content: 'Rewrite each review reply to fix the problems listed for it. Keep the owner\'s voice, keep it short, use only facts from the RECORD or the review, and promise nothing (no refunds, discounts, free items or compensation). Reply JSON only: {"replies":[{"id","reply"}]}' },
          { role: 'user', content: `RECORD\n${sources}\n\n${JSON.stringify(again.map((x) => ({ id: x.review.id, review: x.review.text, reply: x.reply, problems: bad.get(x.review.id) })))}` },
        ], `rewrite ${again.length} replies`, { maxTokens: 1200, json: true, dry: () => JSON.stringify(fx.rewrite(again.map((x) => ({ id: x.review.id, key: x.review.key })))) }), {});
        for (const x of again) {
          const t = String(out.replies?.find((y) => y?.id === x.review.id)?.reply ?? '').trim();
          if (t) { x.reply = t; x.rewritten = true; redo.push({ id: x.review.id, text: t, review: x.review }); }
        }
      } catch (e) { job.log('writer', 'skip', `rewrite failed (${errMsg(e).slice(0, 50)})`); }
    }
    const still = redo.length ? await failing(redo, 2) : new Map<string, string[]>();
    for (const [id, v] of bad) if (!redo.some((i) => i.id === id)) still.set(id, v); // not rewritten: still failing
    for (const x of drafts) if (still.has(x.review.id)) { x.dropped = still.get(x.review.id)!.join('; '); notes.push(`reply to ${first(x.review.who)} left out (${x.dropped})`); }
    if (still.has('description')) { notes.push(`description failed twice (${still.get('description')!.join('; ')}); built from your record instead`); desc = ''; }
    bad = still;
  }
  if (!desc) {
    desc = plainDescription(spec, truth, d, where, sources);
    descFrom = 'record';
  }
  if (!audited) notes.push('the auditor did not answer, so the texts were checked by code only');
  const kept = drafts.filter((x) => !x.dropped);
  job.log('auditor', 'texts', `description ${desc.length} characters (${descFrom === 'record' ? 'built from the record' : descFrom === 'rewrite' ? 'rewritten once' : 'passed first time'}); ${kept.length} of ${drafts.length} replies pass${kept.some((x) => x.rewritten) ? ` (${kept.filter((x) => x.rewritten).length} after a rewrite)` : ''}`);
  return { desc, descFrom, picked: picked.length, drafts, audited, notes };
}

// ---------- 4. profile gaps (rules, no model)

function profileGaps(spec: Spec, truth: Truth, d: BusinessDetails | undefined, top: Rival[], reviews: Review[], drafted: number, desc: string, aiFix: Set<string>, aiRivals: AuditResult['rivals']): Gap[] {
  const g = truth.profile;
  const G: Gap[] = [];
  const row = (x: Gap) => G.push(x);
  const iso = spec.countryIso || 'NG';
  const food = d?.kind === 'food' || FOOD.test(`${truth.category ?? ''} ${spec.category}`);

  if (!truth.listing) {
    row({ item: 'On Google Maps', shows: 'No listing found', ok: false, rank: 0, fix: 'Create one at business.google.com',
      long: `**Get on Google Maps.** We found no Google listing for ${spec.name}. Create a free Business Profile at business.google.com with your address, phone, hours and photos, and verify it. Until you do, you can't appear in the Maps results above, and AI assistants have no Google record to read.` });
    return G;
  }
  row({ item: 'On Google Maps', shows: `Yes: ${truth.name}${truth.category ? ` (${truth.category})` : ''}`, ok: true });

  if (truth.status && /^(permanently|temporarily) closed/.test(truth.status)) row({ item: 'Open or closed', shows: `Marked ${truth.status}`, ok: false, rank: 1, fix: 'Mark it open, if you are',
    long: `**Google says you're ${truth.status}.** Customers who find you are told not to come. If you're open, sign in to your profile and mark it open; if you moved, update the address.` });
  else row({ item: 'Open or closed', shows: truth.status ? 'Open (no closure notice)' : 'Not shown', ok: truth.status ? true : undefined });

  if (truth.claimed === false) row({ item: 'Claimed by you', shows: 'No', ok: false, rank: 2, fix: 'Claim it at business.google.com',
    long: '**Claim your Google profile.** Google shows it as unclaimed, so anyone can suggest changes to your hours and details, and you can\'t add photos or reply to reviews as the owner. Search your business name on Google, choose "Own this business?", and verify it; then work through the profile fixes below.' });
  else row({ item: 'Claimed by you', shows: truth.claimed ? 'Yes' : 'Not shown', ok: truth.claimed ? true : undefined });

  const siteHours = truth.siteFacts.find((f) => f.field === 'hours');
  if (truth.hours?.length) row({ item: 'Opening hours', shows: shortHours(truth.hours), ok: true });
  else row({ item: 'Opening hours', shows: 'Missing', ok: false, rank: 3, fix: 'Add your hours',
    // when the assistants also got the hours wrong, their fix (which names this gap) is the one in the list
    ...(aiFix.has('hours') ? {} : { long: `**Add your opening hours to Google.** Your profile shows none, so Google can't tell customers whether you're open${siteHours ? `; your website says “${siteHours.quote}”` : ''}. Add them, plus special hours for public holidays.` }) });

  const owner = d?.whatsapp ?? d?.phone;
  const same = (a: string, b: string) => !!e164(a, iso) && e164(a, iso) === e164(b, iso);
  if (!truth.phones.length) row({ item: 'Phone', shows: 'Missing', ok: false, rank: 4, fix: owner ? `Add ${owner}` : 'Add your number',
    long: `**Add your phone number to Google.** Customers on Maps tap "Call" first, and your profile has no number${owner ? `. Add ${owner}, the number you gave us` : ''}.` });
  else if (owner && !truth.phones.some((p) => same(p, owner))) row({ item: 'Phone', shows: truth.phones.join(' / '), ok: false, rank: 4.5, fix: `Check it: you gave us ${owner}`,
    long: `**Check the phone number on Google.** Your profile shows ${truth.phones.join(' / ')}, but the number you gave us is ${owner}. If customers should call or WhatsApp ${owner}, change it on Google.` });
  else row({ item: 'Phone', shows: truth.phones.join(' / '), ok: true });

  const ownSite = hostOf(d?.website ?? spec.website), listed = hostOf(truth.website);
  if (listed && ownSite && listed !== ownSite) row({ item: 'Website', shows: listed, ok: false, rank: 4.5, fix: `Link ${ownSite} instead`,
    long: `**Link the right website.** Your Google profile links to ${listed}, but the site you gave us is ${ownSite}. Change the link on Google so customers land on the page you keep up to date.` });
  else if (listed) row({ item: 'Website', shows: listed, ok: true });
  else if (ownSite) row({ item: 'Website', shows: 'Missing', ok: false, rank: 4.5, fix: `Add ${ownSite}`,
    long: `**Add your website to Google.** Your profile has no website link, but you have ${ownSite}. Add it so customers (and AI assistants) can read your prices and hours.` });
  else row({ item: 'Website', shows: 'None', ok: false, fix: d?.instagram ? `Add your Instagram (@${d.instagram}) until you have a site` : 'See the fix list' });

  if (truth.address) row({ item: 'Address', shows: truth.address, ok: true });
  else row({ item: 'Address', shows: 'Missing', ok: false, rank: 4, fix: d?.address ? `Add ${d.address}` : 'Add your address or service area',
    long: `**Add your address to Google.** Your profile shows none${d?.address ? `; you gave us ${d.address}` : ''}. If customers don't visit you, set a service area instead.` });

  if (!g) {
    for (const item of ['Description', 'Photos', 'Services and amenities']) row({ item, shows: 'Not shown (the full profile did not load)' });
  } else {
    const dl = typeof g.description === 'string' ? g.description.trim().length : 0;
    if (!dl) row({ item: 'Description', shows: 'Missing', ok: false, rank: 7.5, fix: 'Paste the one in section 5',
      long: `**Add a description to your Google profile.** It's empty now. We wrote one from your own details (section 5, ${desc.length} characters; Google allows ${MAX_DESC}): paste it under Description when you edit your profile.` });
    else if (dl < 250) row({ item: 'Description', shows: `${dl} characters`, ok: false, rank: 8.5, fix: 'Replace it with the fuller one in section 5',
      long: `**Use the fuller description.** Yours is ${dl} characters; Google allows ${MAX_DESC}. The one in section 5 (${desc.length} characters) says what you sell and where, from your own details.` });
    else row({ item: 'Description', shows: `${dl} characters`, ok: true });

    const photos = num(g.total_photos);
    if (photos === undefined) row({ item: 'Photos', shows: 'Not shown' });
    else if (photos < 10) row({ item: 'Photos', shows: nOf(photos, 'photo'), ok: false, rank: 8, fix: 'Add recent photos',
      long: `**Add photos.** Your profile has ${nOf(photos, 'photo')}. Add clear, recent photos of ${food ? 'your food' : 'your work'}, the inside and outside of your place, and your team, and add new ones every month so the profile looks looked-after.` });
    else row({ item: 'Photos', shows: nOf(photos, 'photo'), ok: true });

    // Services and amenities ("attributes"): first, does Google contradict the website on delivery?
    const avail = flat(g.attributes?.available_attributes), unavail = flat(g.attributes?.unavailable_attributes);
    const delivers = truth.siteFacts.find((f) => f.field === 'delivery');
    const shows = g.attributes ? `${avail.length} listed${avail.length ? ` (${avail.slice(0, 4).map(human).join(', ')})` : ''}` : 'Not shown';
    if (delivers && unavail.some((a) => /deliver/.test(a))) row({ item: 'Services and amenities', shows: `${shows}; says no delivery`, ok: false, rank: 7, fix: 'Turn on delivery',
      long: `**Turn on delivery in your Google profile.** It says you don't deliver, but ${delivers.url === 'the owner (order form)' ? 'you told us' : 'your website says'} “${delivers.quote}”. Edit your profile's services and mark delivery as offered, so Google stops telling customers you don't deliver.` });
    else if (g.attributes && !avail.length) row({ item: 'Services and amenities', shows, ok: false, rank: 8.5, fix: 'Tick the ones you offer',
      long: `**List your services and amenities.** Your profile lists none. Edit it and tick what you offer (${food ? 'dine-in, takeaway, delivery, ' : ''}payment options, accessibility), so you show up when customers look for them.` });
    else row({ item: 'Services and amenities', shows, ok: g.attributes ? true : undefined });
  }

  // Categories: compare with what the businesses above you use
  const mine = [truth.category, ...(Array.isArray(g?.additional_categories) ? g.additional_categories : [])].filter(Boolean).map(String);
  const used = new Map<string, number>();
  for (const r of top) for (const t of uniq([r.last.category, ...r.last.types].filter(Boolean) as string[])) used.set(t, (used.get(t) ?? 0) + 1);
  const missing = g ? [...used.entries()].filter(([t, k]) => k >= 2 && !mine.some((m) => plain(m) === plain(t))).map(([t]) => t) : [];
  const catShows = mine.length ? `${mine[0]}${mine.length > 1 ? ` + ${mine.slice(1).join(', ')}` : ''}` : 'None shown';
  if (missing.length) row({ item: 'Categories', shows: catShows, ok: false, rank: 8.5, fix: `Consider ${missing.map((m) => `“${m}”`).join(', ')}`,
    long: `**Check your categories.** ${missing.map((m) => `“${m}”`).join(' and ')} ${missing.length === 1 ? 'is' : 'are'} used by at least 2 of the businesses that show above you most; you don't have ${missing.length === 1 ? 'it' : 'them'}. If ${missing.length === 1 ? 'it describes' : 'they describe'} what you do, add ${missing.length === 1 ? 'it' : 'them'} as extra categories: Google uses categories to decide which searches you show up for.` });
  else if (g && mine.length === 1) row({ item: 'Categories', shows: catShows, ok: false, rank: 8.5, fix: 'Add extra categories that fit',
    long: `**Add extra categories.** You have one category (${mine[0]}). Add every other one that fits what you sell: Google uses categories to decide which searches you show up for.` });
  else row({ item: 'Categories', shows: catShows, ok: g && mine.length ? true : undefined });

  // Reviews: how many, against the businesses that show above you
  const ours = truth.reviews;
  const more = ours === undefined ? [] : top.filter((r) => (r.last.reviews ?? 0) > ours);
  const low = truth.rating !== undefined && truth.rating < 4;
  const rs = truth.rating !== undefined ? `${truth.rating} from ${fmt(ours)} reviews` : 'No rating yet';
  if (more.length || low || truth.rating === undefined) {
    const ai = aiRivals.slice(0, 3);
    row({ item: 'Rating and reviews', shows: rs, ok: false, rank: 6, fix: 'Ask every happy customer for a review',
      long: `**Get more Google reviews.** ${more.length ? `${list(more.map((r) => `${r.title} (${fmt(r.last.reviews)})`))} ${more.length === 1 ? 'has' : 'have'} more reviews than you (${fmt(ours)}) and ${more.length === 1 ? 'shows' : 'show'} above you on Maps.` : truth.rating === undefined ? 'You have no Google reviews yet.' : ''}${low ? ` Your rating is ${truth.rating}.` : ''} Ask every happy customer for a review (send your review link on WhatsApp after each order), and ask them to mention "${spec.service}" and "${spec.area || spec.city}"${truth.topics.length ? `; today your reviews mostly talk about ${list(truth.topics.slice(0, 3))}` : ''}.${ai.length ? ` AI assistants also recommended ${list(ai.map((r) => `${r.name} (${r.count}×)`))} instead of you.` : ''}` });
  } else row({ item: 'Rating and reviews', shows: rs, ok: true });

  // Replies: what we saw on the reviews we read
  if (!reviews.length) row({ item: 'Replies to reviews', shows: truth.cid ? 'Not checked (no reviews came back)' : 'Not checked' });
  else {
    const answered = reviews.filter((r) => r.replied).length;
    if (answered < reviews.length) row({ item: 'Replies to reviews', shows: `${answered} of the ${reviews.length} reviews we read ${answered === 1 ? 'has' : 'have'} a reply from you`, ok: false, rank: 6.5, fix: drafted ? `Start with the ${drafted} in section 5` : 'Reply to them',
      long: `**Reply to your reviews${drafted ? `, starting with the ${many(drafted, 'reply', 'replies')} we drafted (section 5)` : ''}.** ${reviews.length - answered} of the ${reviews.length} reviews we read ${reviews.length - answered === 1 ? 'has' : 'have'} no reply from you${reviews.some((r) => !r.replied && r.rating <= 3) ? `, including ${nOf(reviews.filter((r) => !r.replied && r.rating <= 3).length, 'complaint')}` : ''}. Customers read the replies, and a calm reply to a bad review is often what they remember.` });
    else row({ item: 'Replies to reviews', shows: `All ${reviews.length} reviews we read have a reply`, ok: true });
  }

  // Menu link, for places that sell food
  if (g && food) {
    const hasMenu = (g.local_business_links ?? []).some((l: any) => /menu/i.test(String(l?.type ?? '')));
    const page = truth.siteFacts.find((f) => f.field === 'price' && /^https?:/.test(f.url));
    if (hasMenu) row({ item: 'Menu link', shows: 'Yes', ok: true });
    else if (page) row({ item: 'Menu link', shows: 'Missing', ok: false, rank: 8.5, fix: `Add ${page.url}`,
      long: `**Add your menu link to Google.** Your prices are on ${page.url}, but your profile has no menu link. Add it when you edit your profile.` });
  }
  return G;
}

// ---------- 5. the service

export const getFound = {
  id: 'get-found',
  name: 'Market & Google Report',
  priceUsd: 2,
  // 20-24 AI answers at 0.10 (cap 0.15) + Business Profile 0.10 + LLM Mentions 0.10 + 19 Maps searches at 0.006
  // + 2 review pages at 0.002 + site read + ~14 LLM calls ≈ 3.1; the cap stays under 4.50 of tools per job.
  policy: { budgetUsd: 5.1 + MAIL_BUDGET_USD, allowHosts: [HOSTS.blockrun, HOSTS.blockrunArc, HOSTS.orthogonal, HOSTS.apex, HOSTS.exa, AISA, ...(MAIL_HOST ? [MAIL_HOST] : [])] },

  async run(brief: string, opts: { orderId?: string; details?: BusinessDetails } = {}): Promise<Job> {
    const job = new Job(this.id, brief, this.policy, opts.orderId);
    try {
      // 1. The brief (the order form's values are exact), the Maps link, the truth
      const d = opts.details;
      const { spec, raw } = await readSpec(job, brief, d, {
        fields: '"searches": the phrases the request says customers type into Google to find a business like this, as a list of at most 2 (e.g. ["jollof rice yaba"]), else []',
        dry: { searches: [] },
      });
      const where = place(spec);
      const link = d?.maps ?? brief.match(/https?:\/\/(?:www\.)?(?:google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)[^\s)>"]*/i)?.[0];
      const hints = await mapsHints(link);
      if (link) job.log('scout', 'link', `the Google Maps link: ${[hints.cid ? `place id ${hints.cid}` : '', hints.lat !== undefined ? 'a map pin' : '', hints.name ? `"${hints.name}"` : ''].filter(Boolean).join(', ') || 'nothing we could read'}`);
      const truth = await gatherTruth(job, spec, hints);
      addOwnerFacts(job, truth, d);
      const record = recordText(spec, truth);
      const searches = searchesFor(spec, d, raw.searches);
      const drop = [...GENERIC, ...words(spec.area), ...words(spec.city)];
      const isUs = (l: Listing) => (truth.cid && l.cid ? l.cid === truth.cid : nameScore(l.title, spec.name, drop) >= 0.6 || (!!truth.domain && hostOf(l.website) === truth.domain));
      const sources = [record, d?.offer ? `The owner describes the business as: ${d.offer}` : '', truth.topics.length ? `What its Google reviews mention most: ${truth.topics.join(', ')}` : ''].filter(Boolean).join('\n');

      // 2. Two lanes at once: the AI audit, and Maps → reviews → texts to paste. The audit starts first so its
      // one Scout call (LLM Mentions) is queued ahead of the grid's 18.
      const aiRun = auditAnswers(job, spec, truth, d, { kinds: KINDS });
      // A third lane: the market itself (competitors, prices, demand), researched and cited (was Market Research).
      // It never fails the report: if it can't finish, the report says so and the rest stands.
      const marketBrief = `Market research for ${spec.name}, ${d?.offer ?? spec.category} in ${[spec.area, spec.city].filter(Boolean).join(', ')}. Cover: the main competitors in that area and what they charge, what customers there look for and pay, demand and trends, and how this business can win.${d?.competitors?.length ? ` Competitors the owner named: ${d.competitors.join(', ')}.` : ''}${d?.research ? ` The owner's own question: ${d.research}` : ''}`;
      const marketRun = researchInto(job, marketBrief).catch((e) => { job.log('researcher', 'skip', `the market research didn't finish (${errMsg(e).slice(0, 60)})`); return null; });
      const mapsRun = (async () => {
        const center = truth.lat !== undefined && truth.lng !== undefined ? { lat: truth.lat, lng: truth.lng } : undefined;
        const grid = await runGrid(job, spec, searches, center, isUs);
        const rivals = rivalsOf(grid, isUs);
        job.log('analyst', 'rank', grid.map((s) => { const st = stats(s); return `"${s.q}": top 3 at ${st.top3} of ${st.n}, shown at ${st.found}`; }).join('; ') + (rivals[0] ? `; above you most: ${rivals[0].title}` : ''));
        let png: Buffer | undefined;
        if (grid.some((s) => s.cells.length === 9 && searched(s).length)) {
          try { const g = gridHtml(spec, grid); png = await htmlToPng(g.html, g.w, g.h); job.log('analyst', 'chart', 'the grid picture (rendered on our server)'); }
          catch (e) { job.log('analyst', 'skip', `grid picture failed (${errMsg(e).slice(0, 60)})`); }
        }
        const reviews = truth.cid ? await readReviews(job, spec, truth.cid) : [];
        if (truth.cid) job.log('scout', 'reviews', `${nOf(reviews.length, 'review')} read (${reviews.filter((r) => r.rating <= 3).length} with 3 stars or fewer)`);
        const paste = await pasteReady(job, spec, truth, d, where, sources, pickReviews(reviews));
        return { grid, rivals, png, reviews, paste };
      })();
      const [ai, mp] = await Promise.allSettled([aiRun, mapsRun]);
      if (ai.status === 'rejected') throw ai.reason;
      if (mp.status === 'rejected') throw mp.reason;
      const r = ai.value;
      const { grid, rivals, png, reviews, paste } = mp.value;

      // 3. Numbers and rules: who outranks you, profile gaps, one fix list
      const total = grid.reduce((s, x) => s + searched(x).length, 0);
      const gridOk = total > 0;
      const top = rivals.slice(0, 3);
      // the form cleans competitors as handles (one word each), so ignore place and category words: "Yaba" names nobody
      const common = new Set([...GENERIC, ...words(`${spec.area} ${spec.city} ${spec.category} ${spec.categoryPlural} ${truth.category ?? ''} restaurant kitchen shop store place`)]);
      const named = (d?.competitors ?? []).filter((h) => squash(h).length >= 4 && !common.has(squash(h))).map((h) => ({ h, r: rivals.find((x) => squash(x.title).includes(squash(h)) || (squash(x.title).length >= 5 && squash(h).includes(squash(x.title)))) }));
      const shown = [...top, ...named.map((x) => x.r).filter((x): x is Rival => !!x && !top.includes(x)).map((x) => ({ ...x, named: 'you named them' }))];
      const kept = paste.drafts.filter((x) => !x.dropped);
      const aiKeys = new Set(r.fixes.map((f) => f.key));
      const gaps = profileGaps(spec, truth, d, top, reviews, kept.length, paste.desc, aiKeys, r.rivals);
      const gapCount = gaps.filter((x) => x.ok === false).length;
      job.log('analyst', 'profile', `${nOf(gapCount, 'profile gap')}: ${gaps.filter((x) => x.ok === false).map((x) => x.item.toLowerCase()).join(', ') || 'none'}`);

      const fixes: Fix[] = gaps.filter((x) => x.long && x.rank !== undefined).map((x) => ({ key: `profile:${x.item}`, rank: x.rank!, text: x.long! }));
      const weak = grid.filter((s) => { const st = stats(s); return st.n && st.top3 < st.n / 2; });
      if (weak.length && truth.listing) {
        const lead = rivals[0];
        fixes.push({ key: 'maps', rank: 5, text: `**Show up in the top 3 for ${list(weak.map((s) => `“${s.q}”`))}.** ${weak.map((s) => { const st = stats(s); return `For “${s.q}” you're in the top 3 at ${st.top3} of the ${st.n} spots we searched from${st.missing ? ` and not in the results at ${st.missing}` : ''}`; }).join('; ')}.${lead ? ` ${lead.title} shows above you at ${lead.above} of ${total} searches.` : ''} Google ranks Maps results by how well a profile matches the search, how close it is, and how well known it is (reviews and rating). You can't move closer, so work on the other two: a description and categories that say "${spec.service}", the profile fixes in this list, and more reviews.` });
      }
      const profileReviews = gaps.some((x) => x.item === 'Rating and reviews' && x.long);
      for (const f of r.fixes) {
        const rank = AI_RANK[f.key];
        if (rank === null || rank === undefined || (f.key === 'reviews' && profileReviews)) continue;
        fixes.push({ ...f, rank });
      }
      fixes.sort((a, b) => a.rank - b.rank);

      // 4. Deterministic QA across the whole report
      const failedCells = grid.reduce((s, x) => s + x.cells.filter((c) => c.error).length, 0);
      const descIssues = descriptionIssues(paste.desc, sources).filter((x) => !(paste.descFrom === 'record' && /too short/.test(x)));
      const replyBad = kept.filter((x) => replyIssues(x.reply, x.review, sources).length);
      const issues = [
        ...r.issues,
        !gridOk ? 'no Maps searches came back' : failedCells ? `${failedCells} of ${failedCells + total} Maps searches failed` : '',
        !hasPin(truth) && truth.listing ? 'no map pin for the listing, so each search ran once for the area' : '',
        descIssues.length ? `description: ${descIssues.join(', ')}` : '',
        replyBad.length ? `${many(replyBad.length, 'reply', 'replies')} still failing a code check` : '',
        ...paste.notes,
      ].filter(Boolean);
      // the job fails only when the evidence can't be trusted (a quote not in its answer) or nearly nothing came back
      const hardFail = !r.literal || (r.answered.length < r.answers.length / 2 && !gridOk);
      job.log('auditor', 'report', `whole report ${hardFail ? 'FAIL' : 'pass'}: ${issues.join('; ') || 'all checks passed'}`);
      job.qa = { verdict: hardFail || r.hardFail || !r.aud.ok || r.unjudged > r.answered.length / 4 || !gridOk || !paste.audited || descIssues.length || replyBad.length ? 'revise' : 'pass', notes: issues.join(' | '), model: `${MODELS.auditor} (blind re-judge of AI answers, check of texts to post) + deterministic checks (quotes, grid, numbers, length)` };

      // 5. Writer: a plain-English summary; every number in it must be in the data handed over
      const lead = rivals[0];
      const facts = {
        business: spec.name, area: where, category: spec.category,
        google_maps: grid.filter((s) => stats(s).n).map((s) => { const st = stats(s); return { search: s.q, spots_searched: st.n, in_top_3_at: st.top3, shown_at: st.found, not_shown_at: st.missing }; }),
        shows_above_you_most: lead && truth.listing ? { name: lead.title, searches: lead.above, of: total } : null,
        shows_up_most_instead_of_you: lead && !truth.listing ? { name: lead.title, searches: lead.above, of: total } : null,
        google_profile_things_to_fix: gapCount, most_urgent_profile_fix: gaps.filter((x) => x.ok === false && x.rank !== undefined).sort((a, b) => a.rank! - b.rank!)[0]?.item ?? null,
        ai_assistants: { recommendation_answers: r.disc.length, named_in: r.named.length, wrong_facts: r.wrong.length, claims_not_in_records: r.made.length,
          most_harmful: r.worst ? { assistant: r.worst.a.label, said: r.worst.f.quote.replace(/\*\*|__|[*`]/g, '').replace(/\s+/g, ' ').trim() } : null },
      };
      job.log('writer', 'summary', 'plain-English summary for the owner');
      let summary = '';
      try {
        summary = (await llm(job, 'writer', [
          { role: 'system', content: 'Write 3 or 4 short sentences for a small-business owner: can customers find them on Google Maps and in AI assistants? Plain words, no jargon, no hype, no advice (a fix list follows). Use only the facts given; never add a number that is not in them. Say where they show on Google Maps and who shows above them, then what the AI assistants say, including the most harmful wrong statement if there is one. Reply with the sentences only.' },
          { role: 'user', content: JSON.stringify(facts) },
        ], 'write the summary', { maxTokens: 350, dry: () => fx.summary(facts) })).trim();
      } catch (e) { job.log('writer', 'skip', `summary failed (${errMsg(e).slice(0, 50)})`); }
      if (!summary || strayNumbers(summary, JSON.stringify(facts)).length) {
        if (summary) job.log('writer', 'redo', 'the summary used a number that is not in the data; using the plain version');
        const m0 = facts.google_maps[0];
        summary = [!m0 ? `We couldn't search Google Maps for you this time.` : m0.spots_searched === 1 ? `For “${m0.search}”, you're ${m0.in_top_3_at ? '' : 'not '}in Google Maps' top 3.` : `For “${m0.search}”, you're in Google Maps' top 3 at ${m0.in_top_3_at} of the ${m0.spots_searched} spots we searched from.`,
          lead ? `${lead.title} shows ${truth.listing ? 'above you' : 'up instead of you'} most often (${lead.above} of ${total} searches).` : '',
          `AI assistants named you in ${r.named.length} of ${r.disc.length} recommendation answers and stated ${nOf(r.wrong.length, 'wrong fact')} about you${r.worst ? ` (${r.worst.a.label}: “${facts.ai_assistants.most_harmful!.said}”)` : ''}.`].filter(Boolean).join(' ');
      }

      // 6. The report
      const top3All = grid.reduce((s, x) => s + stats(x).top3, 0);
      const L: string[] = [`# ${spec.name}: market & Google report`, '', `${spec.name} · ${spec.category} · ${where} · checked ${today()}`, '',
        `**Google Maps: ${total ? `top 3 at ${top3All} of ${total} searches` : 'no searches came back'} · Google profile: ${nOf(gapCount, 'thing')} to fix · AI assistants: named in ${r.named.length} of ${r.disc.length} recommendation answers, ${nOf(r.wrong.length, 'wrong fact')}**`, '', summary, ''];

      L.push('## 1. Where you show on Google Maps', '');
      if (!truth.listing) L.push(`We found no Google listing for ${spec.name}, so you can't appear in these results yet. Here is what customers see instead.`, '');
      const pinned = grid.some((s) => s.cells.length === 9);
      const ofs = uniq(grid.flatMap((s) => searched(s).map((c) => c.of)));
      if (!gridOk) L.push('The Maps searches did not come back this time (the seller was down), so there are no positions to show. Ask for a revision and we will run them again.', '');
      else {
        if (pinned) L.push(`We searched Google Maps from 9 spots: your listing's own location (the middle square) and 8 around it, ${STEP_KM} km apart, the way a customer standing there would. Each number is your position in the list Google showed. Google search shows only the first 3 in its map box, so 1 to 3 is where customers look; “>${ofs.length === 1 ? ofs[0] : 'N'}” means you weren't in the ${ofs.length === 1 ? ofs[0] : `${Math.min(...ofs)} to ${Math.max(...ofs)}`} results Google returned there.${png ? ' The picture is `maps-grid.png`.' : ''}`, '');
        for (const s of grid) {
          const st = stats(s);
          if (!st.n) { L.push(`- **“${s.q}”**: the searches failed, so there are no positions to show.`, ''); continue; }
          if (s.cells.length !== 9) {
            const c = s.cells[0];
            L.push(`- **“${s.q}”**, searched once for ${spec.area || spec.city}: ${c.rank ? `you're **#${c.rank}** of ${c.of}` : `you're not in the ${c.of} results`}.`);
            continue;
          }
          L.push(`### “${s.q}”`, '', `**Top 3 at ${st.top3} of ${st.n} spots · in the results at ${st.found} of ${st.n}${st.best ? ` · best position ${st.best}` : ''}**`, '',
            '| | West | Middle | East |', '|---|---|---|---|',
            ...[0, 1, 2].map((row) => `| **${['North', 'Middle', 'South'][row]}** | ${[0, 1, 2].map((col) => { const c = s.cells[row * 3 + col]; const t = cellText(c); return c.rank && c.rank <= 3 ? `**${t}**` : t; }).join(' | ')} |`), '');
          const here = rivalsOf([s], isUs).filter((x) => x.above).slice(0, 3);
          if (here.length) L.push(`Shown above you most often for this search: ${here.map((x) => `${x.title} (at ${x.above} of ${st.n} spots)`).join(', ')}.`, '');
        }
        if (!pinned) L.push('');
      }

      L.push(truth.listing ? '## 2. You and the businesses that show above you most' : '## 2. The businesses customers find instead', '');
      if (shown.length) {
        const ownRow = grid.flatMap((s) => s.cells.flatMap((c) => c.all.filter(isUs)))[0];
        L.push(`| Business | ${truth.listing ? 'Above you' : 'Shown in'} | Rating | Reviews | Main category | Website | Hours on Google |`, '|---|---|---|---|---|---|---|');
        L.push(`| **You: ${cell(spec.name)}** | — | ${stars(truth.rating ?? ownRow?.rating)} | ${fmt(truth.reviews ?? ownRow?.reviews)} | ${cell(truth.category ?? ownRow?.category ?? '—')} | ${hostOf(truth.website) || 'None'} | ${truth.hours?.length ? 'Yes' : ownRow ? (ownRow.hours ? 'Yes' : 'No') : 'No'} |`);
        for (const x of shown) L.push(`| ${cell(x.title)}${x.named ? ` (${x.named})` : ''} | ${x.above} of ${total} searches | ${stars(x.last.rating)} | ${fmt(x.last.reviews)} | ${cell(x.last.category ?? '—')} | ${hostOf(x.last.website) || 'None'} | ${x.last.hours ? 'Yes' : 'No'} |`);
        const ours = truth.reviews ?? ownRow?.reviews, rate = truth.rating ?? ownRow?.rating;
        const notes = [
          ours !== undefined && shown.some((x) => (x.last.reviews ?? 0) > ours) ? `${list(shown.filter((x) => (x.last.reviews ?? 0) > ours).map((x) => x.title))} ${shown.filter((x) => (x.last.reviews ?? 0) > ours).length === 1 ? 'has' : 'have'} more Google reviews than you` : '',
          rate !== undefined && shown.some((x) => (x.last.rating ?? 0) > rate) ? `${list(shown.filter((x) => (x.last.rating ?? 0) > rate).map((x) => x.title))} ${shown.filter((x) => (x.last.rating ?? 0) > rate).length === 1 ? 'has' : 'have'} a higher rating` : '',
          shown.some((x) => !x.last.website) ? `${list(shown.filter((x) => !x.last.website).map((x) => x.title))} ${shown.filter((x) => !x.last.website).length === 1 ? 'has' : 'have'} no website on Google` : '',
          shown.some((x) => !x.last.hours) ? `${list(shown.filter((x) => !x.last.hours).map((x) => x.title))} ${shown.filter((x) => !x.last.hours).length === 1 ? 'shows' : 'show'} no opening hours` : '',
        ].filter(Boolean);
        L.push('', `Everything here is from the Google Maps results we pulled${notes.length ? `: ${notes.join('; ')}.` : '.'}`);
        const absent = named.filter((x) => !x.r).map((x) => x.h);
        if (absent.length) L.push('', `You also named ${list(absent.map((h) => `“${h}”`))}: ${absent.length === 1 ? 'it' : 'they'} didn't appear in any of the ${total} searches.`);
        L.push('');
      } else L.push(gridOk ? 'No other businesses showed above you.' : 'No Maps results to compare this time.', '');

      L.push('## 3. Your Google profile', '', `Checked against what Google returned on ${today()}, most urgent first. ${gapCount ? `${nOf(gapCount, 'thing')} to fix.` : 'Nothing to fix.'}`, '',
        '| | What Google shows | Fix |', '|---|---|---|');
      const order = [...gaps].sort((a, b) => (a.ok === false ? 0 : a.ok ? 1 : 2) - (b.ok === false ? 0 : b.ok ? 1 : 2) || (a.rank ?? 99) - (b.rank ?? 99));
      for (const x of order) L.push(`| ${x.item} | ${cell(x.shows)} | ${x.ok === false ? `**${cell(x.fix ?? 'See the fix list')}**` : x.ok ? 'Good' : 'Not checked'} |`);
      L.push('');

      L.push('## 4. What AI assistants say about you', '', r.md.stats, '', ...r.md.scorecard('###'), ...r.md.wrongFacts('###'), ...r.md.madeUp('###'), ...r.md.unanswered('###'), ...r.md.rivals('###'), ...r.md.sources('###'));

      L.push('## 5. Ready to paste', '', '### Your Google profile description', '',
        `${paste.desc.length} of Google's ${MAX_DESC} characters${paste.descFrom === 'record' ? ', put together from your record' : ''}. ${truth.listing ? 'On Google, search your business name, choose Edit profile, and paste it under Description.' : 'Paste it under Description when you create your profile.'}`, '',
        ...paste.desc.split('\n').map((x) => `> ${x}`), '');
      if (paste.drafts.length || reviews.length) {
        L.push('### Replies to your reviews', '');
        if (kept.length) {
          L.push('Read each one before you post it (on your profile, open Reviews and choose Reply) and change anything that isn\'t right. None of them promises a refund, discount or anything free.', '');
          for (const x of kept) L.push(`**${first(x.review.who)}, ${nOf(x.review.rating, 'star')}${x.review.when ? `, ${x.review.when}` : ''}:** “${cell(x.review.text)}”`, '', ...x.reply.split('\n').map((l) => `> ${l}`), '');
        } else L.push(!paste.picked ? 'Every review we read already has a reply from you.' : paste.drafts.length ? 'None of the drafts passed our checks.' : 'We could not draft replies this time.', '');
        const left = paste.drafts.filter((x) => x.dropped);
        if (left.length) L.push(`We left ${many(left.length, 'reply', 'replies')} for you to write yourself, because the draft failed our checks twice: ${left.map((x) => `${first(x.review.who)} (${x.review.rating} stars): “${cell(x.review.text.slice(0, 120))}”`).join('; ')}.`, '');
      }

      L.push('## 6. What to fix, most urgent first', '', ...(fixes.length ? fixes.slice(0, 10).map((f, i) => `${i + 1}. ${f.text}`) : ['Nothing urgent: you show up well and the assistants got your facts right. Re-check in a month; both change.']), '');
      if (fixes.length > 10) L.push(`${many(fixes.length - 10, 'smaller fix', 'smaller fixes')} not shown: ${fixes.slice(10).map((f) => f.text.match(/^\*\*(.+?)\*\*/)?.[1] ?? '').filter(Boolean).join(' ')}`, '');

      const market = await marketRun;
      L.push('## 7. Your market', '', ...(market
        ? [market.markdown.replace(/^#\s+[^\n]*\n+/, '').replace(/^(#{1,4})\s/gm, (_, h: string) => `${h}#${h.length === 1 ? '#' : ''} `), '', `*Every claim is cited to a source you can open, and an independent model (${MODELS.auditor}) checked each one against its source${market.qa.verdict === 'revise' ? '; it found issues and the section was revised once' : ''}.*`]
        : ['The market research could not be finished this time. The rest of the report stands; ask for a revision to get this section.']), '');
      L.push(...r.md.detail('##'), ...r.md.record('##'));
      L.push('## How this was done', '',
        `- **Google Maps:** ${searches.length} search${searches.length === 1 ? '' : 'es'} (${searches.map((q) => `“${q}”`).join(', ')}${d?.searches ? ', as you gave them' : ', from your category, area and what customers look for'}) ${pinned ? `from 9 spots ${STEP_KM} km apart around your listing's map pin` : 'once each for your area, because we had no map pin for your listing'}, through Serper's Google Maps results on ${today()}. Your listing was matched by its Google ID${truth.cid ? '' : ' (we had none, so by its name and website)'}; a similar name is never counted as you.${failedCells ? ` ${failedCells} search${failedCells === 1 ? '' : 'es'} failed and show as “?”.` : ''} Results also depend on time, device and the customer's own history: this is a snapshot.`,
        `- **Google profile:** fixed rules run on your Business Profile as Google returned it (through DataForSEO), compared with the details you gave us, your website and the businesses above you. No model decides what's a gap.`,
        `- **Texts to paste:** written from your record only. Code checked the description's length (Google allows ${MAX_DESC} characters), that it has no links, phone numbers or prices, and that every number in it and in the replies is in your record or the review. ${paste.audited ? `An independent model (${MODELS.auditor}) then checked them for promises (refunds, discounts, free items) and invented facts.` : 'The independent check did not answer this time, so they were checked by code only: read them carefully.'}${paste.drafts.some((x) => x.rewritten) || paste.descFrom === 'rewrite' ? ` ${nOf(paste.drafts.filter((x) => x.rewritten).length + (paste.descFrom === 'rewrite' ? 1 : 0), 'text')} failed a check and ${paste.drafts.filter((x) => x.rewritten).length + (paste.descFrom === 'rewrite' ? 1 : 0) === 1 ? 'was' : 'were'} rewritten once.` : ''}`,
        ...r.md.method.map((x) => x.replace(/^- (\d+ questions)/, '- **AI assistants:** $1')),
        '', `Files: ${png ? '`maps-grid.png` (the grid picture), ' : ''}\`maps-grid.csv\` (every Maps search and who showed above you), \`answers.csv\` (one row per AI answer), \`ai-answers.md\` (every AI answer in full, with its sources).`);
      if (issues.length) L.push('', `> QA notes: ${issues.join('; ')}.`);
      job.deliverable = L.join('\n');

      if (png) job.files.unshift({ name: 'maps-grid.png', content: png });
      const rows = grid.flatMap((s) => s.cells.map((c) => [s.q, c.pt.label, c.pt.lat?.toFixed(6) ?? '', c.pt.lng?.toFixed(6) ?? '', c.rank ?? '', c.of || '',
        c.all.slice(0, 3).map((l) => `${l.position}. ${l.title}`).join(' | '), c.above.map((l) => l.title).join(' | '), c.error ?? (c.rank ? '' : `not in the ${c.of} results`)].map(csvCell).join(',')));
      job.files.push({ name: 'maps-grid.csv', content: ['search,spot,latitude,longitude,your_position,results_returned,top_3,shown_above_you,note', ...rows].join('\n') + '\n' }, ...r.files);

      job.status = hardFail ? 'failed' : 'delivered';
      if (hardFail) job.error = `QA failed: ${issues.join('; ')}`;
    } catch (e: any) {
      job.status = 'failed';
      job.error = errMsg(e);
      console.error('  ✗', job.error);
    }
    job.save();
    return job;
  },
};

const hasPin = (t: Truth) => t.lat !== undefined && t.lng !== undefined;
