// AI Answer Audit: what ChatGPT, Gemini, Claude and Perplexity tell customers about a local business.
// Researcher parses the brief → Scout pulls the truth from Google (Serper Maps, then the full Business
// Profile from DataForSEO) → Reader reads the business's own site (APEX) → Investigator and Researcher ask
// 6 customer questions to 4 assistants with web search on (DataForSEO LLM Responses via AIsa, two lanes)
// → Analyst checks every statement against the record → deterministic QA: every quote and competitor must
// appear word for word in the saved answer → Auditor (other model family) re-judges every statement blind;
// a statement counts as wrong only when both agree → Writer summarises; the fix list is rules, not an LLM.
// The pieces are exported so Get Found runs the same audit inside its own job: readSpec, gatherTruth,
// addOwnerFacts, then auditAnswers (structured results + markdown sections). This service is a thin
// wrapper over them; it is off the menu, but old orders can still be revised.
import type { BusinessDetails } from '../details.ts';
import { parseMenu } from '../site/facts.ts';
import { Job } from '../job.ts';
import { MODELS } from '../config.ts';
import { HOSTS, llm, parseJson, readPages, type Page } from '../tools.ts';
import { AISA, dataforseo, ortho } from '../sellers.ts';
import { buy, SpendRefused } from '../x402.ts';
import { MAIL_BUDGET_USD, MAIL_HOST } from '../mail.ts';
import type { Role } from '../wallets.ts';
import * as fx from './ai-answer-audit.fixtures.ts';

export type Spec = { name: string; website: string; area: string; city: string; country: string; countryIso: string; category: string; categoryPlural: string; service: string; priceItem: string };
export type Kind = 'hours' | 'status' | 'price' | 'best' | 'service' | 'recommend' | 'custom';
type Prompt = { kind: Kind; type: 'direct' | 'discovery'; text: string; expects: string[] };
type Cite = { title: string; url: string };
type Verdict = 'correct' | 'wrong' | 'made_up' | 'unverifiable';
type Fact = { id: string; field: string; quote: string; claim: string; verdict: Verdict; truth: string; final?: Verdict | 'disputed'; auditNote?: string };
type EngineId = 'chatgpt' | 'gemini' | 'claude' | 'perplexity';
export type Answer = {
  id: string; engine: EngineId; label: string; model: string; webSearch?: boolean; prompt: Prompt; text: string; cites: Cite[]; error?: string;
  named?: boolean; rank?: [number, number]; facts: Fact[]; missing: string[]; competitors: string[];
};
type SiteFact = { field: string; value: string; quote: string; url: string };
export type Truth = {
  listing: boolean; name?: string; category?: string; address?: string; phones: string[]; website?: string; hours?: string[]; status?: string;
  rating?: number; reviews?: number; claimed?: boolean; alsoSearch: string[]; topics: string[];
  domain?: string; social?: boolean; siteRead: boolean; siteFacts: SiteFact[]; conflicts: (SiteFact & { google: string })[];
  // where the listing is, and the raw records, for services that build on the audit (Get Found)
  cid?: string; lat?: number; lng?: number; place?: any; profile?: any;
};
/** What a Google Maps link tells us before any paid call: the place's cid, its pin and its name. */
export type MapsHints = { cid?: string; lat?: number; lng?: number; name?: string };
type Engine = { id: EngineId; label: string; path: string; models: string[]; body: (s: Spec, geo: boolean) => Record<string, unknown> };

const CLAUDE_COUNTRIES = 'AR AT AU BE BR CA CH CL CN DE DK ES FI FR GB HK ID IN IT JP KR MX MY NL NO NZ PH PL PT RU SA SE TR TW US ZA'.split(' ');
// Model names DataForSEO documents with web search. A base name resolves to its newest version, which comes
// back in every answer and is printed in the report. A rejected name falls through to the next one, and the
// one that works is remembered for later jobs in this process, so a retired model costs one call, once.
const ENGINES: Engine[] = [
  { id: 'chatgpt', label: 'ChatGPT', path: 'chat_gpt', models: ['gpt-5-mini', 'gpt-4o-mini'],
    body: (s, geo) => ({ web_search: true, ...(geo ? { web_search_country_iso_code: s.countryIso, web_search_city: s.city } : {}) }) },
  { id: 'gemini', label: 'Gemini', path: 'gemini', models: ['gemini-2.5-flash', 'gemini-2.0-flash'], body: () => ({ web_search: true }) },
  // Claude is left out until DataForSEO accepts a Claude model name again: both names were rejected on live jobs,
  // and each rejected call was still paid for.
  // Sonar always searches the web; its request has no web_search field
  { id: 'perplexity', label: 'Perplexity', path: 'perplexity', models: ['sonar', 'sonar-pro'], body: (s, geo) => (geo ? { web_search_country_iso_code: s.countryIso } : {}) },
];
// buy() serializes calls per agent, so two agents means two answers in flight at a time
const LANES: { agent: Role; engines: EngineId[] }[] = [{ agent: 'investigator', engines: ['chatgpt', 'gemini'] }, { agent: 'researcher', engines: ['perplexity'] }];
/** Questions about the business by name go to the two assistants most people use; "recommend me one" questions go
 *  to every assistant, since that's where a business is won or lost. */
const enginesFor = (p: { type: string }) => (p.type === 'direct' ? ENGINES.filter((e) => e.id !== 'perplexity') : ENGINES);
const preferred: Partial<Record<EngineId, string>> = {};
const noGeo = new Set<EngineId>();

// ---------- text helpers

export const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const cell = (s: unknown) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();
export const hostOf = (u?: string) => {
  try { return u ? new URL(u.startsWith('http') ? u : `https://${u}`).host.replace(/^www\./, '') : ''; } catch { return ''; }
};
export const uniq = <T>(xs: T[]) => [...new Set(xs)];
export const plain = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const GENERIC = ['the', 'and', 'ltd', 'limited', 'branch', 'inc', 'llc', 'plc', 'co', 'nig'];
export const words = (s: string, drop: string[] = []) => new Set(plain(s).split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !drop.includes(w)));
/** Jaccard overlap of two business names, ignoring location words and legal suffixes. */
export function nameScore(a: string, b: string, drop: string[] = GENERIC): number {
  const A = words(a, drop), B = words(b, drop);
  if (!A.size || !B.size) return 0;
  const inter = [...A].filter((w) => B.has(w)).length;
  return inter / (A.size + B.size - inter);
}
const fold = (ch: string) => /[*_`#]/.test(ch) ? '' : /\s/.test(ch) ? ' ' : /[‘’´]/.test(ch) ? "'" : /[“”«»]/.test(ch) ? '"' : /[\u2010-\u2015\u2212]/.test(ch) ? '-' : ch.toLowerCase();
/**
 * Finds `quote` in `text` ignoring case, markdown emphasis, curly quotes, dash styles and spacing, and
 * returns that exact span of the original text: every quote we print is literally in the saved answer.
 */
function locate(text: string, quote: string): string | undefined {
  let flat = '';
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    for (const c of fold(text[i])) {
      if (c === ' ' && (!flat || flat.endsWith(' '))) continue;
      flat += c; at.push(i);
    }
  }
  const q = [...quote].map(fold).join('').replace(/\s+/g, ' ').trim();
  if (q.length < 3) return undefined;
  const k = flat.indexOf(q);
  return k < 0 ? undefined : text.slice(at[k], at[k + q.length - 1] + 1);
}
const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
export const today = () => { const d = new Date(); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
export const place = (s: Spec) => (s.area && s.city && !plain(s.area).includes(plain(s.city)) ? `${s.area}, ${s.city}` : s.area || s.city);
export const errMsg = (e: any) => String(e?.message ?? e);
export const nOf = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const FIELD: Record<string, string> = { deals: 'deal', offer: 'deal', offers: 'deal', discount: 'deal', discounts: 'deal', promotion: 'deal', prices: 'price', opening_hours: 'hours', phone_number: 'phone', open: 'status' };
const field = (f: unknown) => { const k = String(f ?? 'other').toLowerCase().trim(); return FIELD[k] ?? k; };
const ASKED: Record<string, string> = { hours: 'opening hours', status: 'open or closed', address: 'address', phone: 'phone number', price: 'prices', deal: 'deals', other: 'an answer to your question' };
const asked = (ms: string[]) => ms.map((m) => ASKED[m] ?? m).join(', ');
/** A quote for display: QA checks the raw span, but a span can straddle a **bold** boundary. */
const shown = (q: string) => q.replace(/\*\*|__|[*`]/g, '').replace(/\s+/g, ' ').trim();

// ---------- 1. the truth: Google listing + the business's own website

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const t12 = (h: number, m = 0) => `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h % 24 < 12 ? 'AM' : 'PM'}`;
function hoursFrom(gbp: any, maps: any): string[] | undefined {
  const tt = gbp?.work_time?.work_hours?.timetable;
  if (tt && typeof tt === 'object') {
    return DAYS.map((d) => {
      const slots: any[] = tt[d] ?? [];
      const span = slots.map((s) => `${t12(s?.open?.hour ?? 0, s?.open?.minute)}–${t12(s?.close?.hour ?? 0, s?.close?.minute)}`).join(', ');
      return `${d[0].toUpperCase()}${d.slice(1)}: ${span || 'Closed'}`;
    });
  }
  const oh = maps?.openingHours;
  if (oh && typeof oh === 'object') return Object.entries(oh).map(([d, h]) => `${d}: ${h}`);
  return typeof oh === 'string' ? [oh] : undefined;
}
/** "Monday: 8 AM–9 PM", … → "Mon–Sat 8 AM–9 PM; Sun 12 PM–8 PM" */
export function shortHours(h?: string[]): string {
  if (!h?.length) return 'not listed';
  const rows = h.map((x) => { const i = x.indexOf(': '); return [i < 0 ? '' : x.slice(0, 3), x.slice(i + 2)]; });
  if (rows.some(([d]) => !d)) return h.join('; ');
  const out: string[] = [];
  for (let i = 0; i < rows.length;) {
    let j = i;
    while (j + 1 < rows.length && rows[j + 1][1] === rows[i][1]) j++;
    out.push(`${rows[i][0]}${j > i ? `–${rows[j][0]}` : ''} ${rows[i][1]}`);
    i = j + 1;
  }
  return out.join('; ');
}

function statusFrom(gbp: any): string | undefined {
  const s = String(gbp?.work_time?.work_hours?.current_status ?? '');
  if (!s) return undefined;
  // "opened"/"closed" only say whether it is open at this minute; the closure flags are the other two
  return /forever|permanent/i.test(s) ? 'permanently closed' : /temporar/i.test(s) ? 'temporarily closed' : 'operating (not marked temporarily or permanently closed)';
}

/** APEX web-read, up to 10 pages for $0.003: the call tools.webRead makes, with this service's own dry fixture. */
async function readSite(job: Job, urls: string[], reason: string): Promise<Page[]> {
  const data = await buy<any>(job, {
    agent: 'reader', vendor: 'APEX web-read', url: `https://${HOSTS.apex}/api/x402/web-read?${new URLSearchParams({ urls: urls.join(',') })}`, method: 'GET',
    reason, expectUsd: 0.003, maxUsd: 0.006, dryData: () => fx.site(urls),
  });
  return (data?.pages ?? data?.results ?? data?.data ?? []).map((p: any) => ({ url: p.finalUrl ?? p.url, title: p.title ?? p.url, text: String(p.text ?? p.body ?? p.content ?? '').slice(0, 8000) }));
}

/**
 * The truth: the Google listing (Serper Maps, then the full Business Profile) and the business's own site.
 * `hints` come from a Google Maps link the owner gave: a cid pins the listing even when the name differs,
 * and a pin centres the Maps search on it.
 */
export async function gatherTruth(job: Job, spec: Spec, hints: MapsHints = {}): Promise<Truth> {
  const t: Truth = { listing: false, phones: [], alsoSearch: [], topics: [], siteRead: false, siteFacts: [], conflicts: [] };
  const drop = [...GENERIC, ...words(spec.area), ...words(spec.city)];
  const wantDomain = hostOf(spec.website);

  // Serper Maps first: cheap, and gives the cid that pins the Business Profile lookup to the right place
  let hit: any;
  const q = [spec.name, spec.area, spec.city].filter(Boolean).join(' ');
  try {
    job.log('scout', 'maps', `Google Maps: "${q}"`);
    const ll = hints.lat !== undefined && hints.lng !== undefined ? `@${hints.lat.toFixed(6)},${hints.lng.toFixed(6)},15z` : undefined;
    const data = await ortho<any>(job, 'serper/maps', { body: { q, gl: spec.countryIso.toLowerCase() || undefined, ...(ll ? { ll } : {}) } }, {
      agent: 'scout', vendor: 'Serper Maps (Orthogonal)', reason: `find ${spec.name}'s Google listing`, expectUsd: 0.006, maxUsd: 0.01, dry: fx.maps,
    });
    const score = (p: any) => Math.max(nameScore(p.title ?? '', spec.name, drop), hints.name ? nameScore(p.title ?? '', hints.name, drop) : 0, wantDomain && hostOf(p.website) === wantDomain ? 1 : 0);
    const scored = (data?.places ?? []).map((p: any) => ({ p, s: hints.cid && String(p.cid ?? '') === hints.cid ? 2 : score(p) }));
    hit = scored.filter((x: any) => x.s >= 0.6).sort((a: any, b: any) => b.s - a.s)[0]?.p;
    // the owner's own link is exact: a name match with another cid is a different place (a second branch, a namesake)
    if (hit && hints.cid && hit.cid && String(hit.cid) !== hints.cid) {
      job.log('scout', 'skip', `"${hit.title}" on Maps is not the place in your link; using the link`);
      hit = undefined;
    }
    job.log('scout', 'match', hit ? `${hit.title}, ${hit.address ?? ''}` : hints.cid ? 'using the listing in your Google Maps link' : `no listing on Maps matches "${spec.name}"`);
  } catch (e) { job.log('scout', 'skip', `Maps failed (${errMsg(e).slice(0, 60)}); trying the Business Profile directly`); }

  let gbp: any;
  const cid = hit?.cid ? String(hit.cid) : hints.cid;
  // the paid profile lookup only when there's a listing to look up (a match on Maps, or the owner's own link)
  const pin = hit?.latitude ? [Number(hit.latitude), Number(hit.longitude)] : hints.lat !== undefined && hints.lng !== undefined ? [hints.lat, hints.lng] : undefined;
  if (!hit && !hints.cid) job.log('scout', 'skip', 'no Google listing to read the full profile of');
  else try {
    const task = {
      keyword: cid ? `cid:${cid}` : q,
      ...(pin ? { location_coordinate: `${pin[0].toFixed(6)},${pin[1].toFixed(6)},2000` } : { location_name: spec.country }),
      language_code: 'en',
    };
    job.log('scout', 'profile', 'full Google Business Profile: hours timetable, open/closed flag, claimed, review topics');
    const [r] = await dataforseo<any>(job, 'business_data/google/my_business_info/live', task, {
      agent: 'scout', vendor: 'Google Business Profile (DataForSEO)', reason: `${spec.name}'s Google Business Profile`, dry: fx.gbp,
    });
    const it = r?.items?.[0];
    if (it && (cid || nameScore(it.title ?? '', spec.name, drop) >= 0.6)) gbp = it;
    else if (it) job.log('scout', 'skip', `the profile Google returned ("${it.title}") is a different business`);
  } catch (e) { job.log('scout', 'skip', `Business Profile failed (${errMsg(e).slice(0, 60)})`); }

  t.listing = !!(hit || gbp);
  t.place = hit;
  t.profile = gbp;
  t.cid = gbp?.cid ? String(gbp.cid) : cid;
  const lat = Number(gbp?.latitude ?? pin?.[0]), lng = Number(gbp?.longitude ?? pin?.[1]);
  if (Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng)) { t.lat = lat; t.lng = lng; }
  t.name = gbp?.title ?? hit?.title;
  t.category = gbp?.category ?? hit?.type;
  t.address = gbp?.address ?? hit?.address;
  t.phones = uniq([gbp?.phone, hit?.phoneNumber].filter(Boolean).map(String));
  t.website = gbp?.url ?? hit?.website;
  t.hours = hoursFrom(gbp, hit);
  t.status = statusFrom(gbp);
  t.rating = gbp?.rating?.value ?? hit?.rating;
  t.reviews = gbp?.rating?.votes_count ?? hit?.ratingCount;
  t.claimed = typeof gbp?.is_claimed === 'boolean' ? gbp.is_claimed : undefined;
  t.alsoSearch = (gbp?.people_also_search ?? []).map((x: any) => (typeof x === 'string' ? x : x?.title)).filter(Boolean).slice(0, 8);
  t.topics = Object.entries(gbp?.place_topics ?? {}).sort((a: any, b: any) => b[1] - a[1]).slice(0, 6).map(([k]) => k);

  // The business's own pages: one APEX call covers up to 10 URLs
  t.domain = wantDomain || hostOf(t.website) || undefined;
  if (t.domain && /facebook|instagram|linktr|wa\.me|tiktok|x\.com|twitter/.test(t.domain)) { t.social = true; t.domain = undefined; }
  if (t.domain) {
    const urls = ['', '/contact', '/about', '/menu', '/services', '/prices'].map((p) => `https://${t.domain}${p}`);
    let pages: Page[] = [];
    try {
      job.log('reader', 'read site', `${urls.length} pages on ${t.domain}`);
      pages = await readSite(job, urls, `read ${t.domain}: hours, prices, offers`);
    } catch (e) {
      job.log('reader', 'switch', `APEX failed (${errMsg(e).slice(0, 50)}); reading the homepage and contact page with Exa`);
      try { pages = await readPages(job, 'reader', urls.slice(0, 2), `read ${t.domain}'s homepage and contact page`); } catch (e2) { job.log('reader', 'skip', `could not read ${t.domain} (${errMsg(e2).slice(0, 50)})`); }
    }
    const seen = new Set<string>();
    pages = pages.filter((p) => {
      const key = p.text.slice(0, 400);
      if (p.text.length < 80 || /\b404\b|not found|doesn.t exist/i.test(p.text.slice(0, 300)) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (pages.length) {
      t.siteRead = true;
      const listing = [`hours: ${t.hours?.join('; ') ?? 'not listed'}`, `phone: ${t.phones.join(' / ') || 'not listed'}`, `address: ${t.address ?? 'not listed'}`].join('\n');
      const ex = parseJson<{ facts?: SiteFact[]; conflicts?: (SiteFact & { google: string })[] }>(
        await llm(job, 'reader', [
          { role: 'system', content: 'You extract what a customer would ask about from a business\'s own web pages. Copy, never guess. Every item needs a "quote" copied word for word from the page (5-30 words) and the page "url". Fields: hours, phone, address, price (one item per product or service with its price), offer (current deals, discounts, promotions), service (main products or services), delivery, other. Then compare the pages with the Google listing given and list "conflicts" where they state different hours, phone or address. Reply JSON only: {"facts":[{"field","value","quote","url"}],"conflicts":[{"field","google","website","quote","url"}]}' },
          { role: 'user', content: `Google listing:\n${listing}\n\n` + pages.map((p) => `=== ${p.url}\n${p.text.slice(0, 5000)}`).join('\n\n').slice(0, 22000) },
        ], `pull hours, prices and offers from ${pages.length} pages`, { model: MODELS.fast, maxTokens: 1800, json: true, dry: () => JSON.stringify(fx.siteFacts()) }),
        { facts: [], conflicts: [] },
      );
      const all = pages.map((p) => p.text).join('\n');
      const verify = <T extends SiteFact>(x: T) => { const quote = locate(all, String(x?.quote ?? '')); return quote ? { ...x, quote } : undefined; };
      t.siteFacts = (ex.facts ?? []).map(verify).filter((x): x is SiteFact => !!x?.value);
      t.conflicts = (ex.conflicts ?? []).map(verify).filter((x): x is SiteFact & { google: string } => !!x?.google);
      const lost = (ex.facts?.length ?? 0) - t.siteFacts.length;
      job.log('reader', 'facts', `${t.siteFacts.length} facts with verbatim quotes${lost ? ` (${lost} dropped: quote not on the page)` : ''}${t.conflicts.length ? `; ${t.conflicts.length} conflict(s) with Google` : ''}`);
    }
  }
  return t;
}

/** The record the analyst and auditor judge against, as plain text. */
export function recordText(spec: Spec, t: Truth): string {
  const L = [`RECORD for ${spec.name} (${spec.category}, ${place(spec)}), checked ${today()}. This is the truth to judge against.`];
  if (t.listing) {
    L.push(`Google listing name: ${t.name}`, `Category: ${t.category ?? 'not listed'}`, `Address: ${t.address ?? 'not listed'}`,
      `Phone: ${t.phones.join(' / ') || 'not listed'} (the same number may be written with +234/country code or a leading 0)`,
      `Website on the listing: ${t.website ?? 'none'}`,
      `Opening hours on Google: ${t.hours?.join('; ') ?? 'not listed'}`,
      `Status on Google: ${t.status ?? 'listed on Google Maps, no closure notice seen'}`,
      `Rating: ${t.rating ? `${t.rating} from ${t.reviews ?? '?'} Google reviews` : 'none'}`);
  } else L.push('Google listing: none found on Google Maps.');
  if (t.siteRead) {
    L.push(`Its website ${t.domain}, read today:`);
    for (const f of t.siteFacts) L.push(`- ${f.field}: ${f.value} ("${f.quote}", ${f.url})`);
    if (!t.siteFacts.some((f) => f.field === 'price')) L.push('- prices: the website lists none');
    for (const c of t.conflicts) L.push(`- NOTE: the website says "${c.quote}" but Google says ${c.google}`);
  } else L.push(t.domain ? `Website ${t.domain}: could not be read.` : 'Website: none.');
  const offers = t.siteFacts.filter((f) => f.field === 'offer');
  L.push(`Deals, discounts, promotions: ${offers.length ? 'only those listed above' : t.siteRead ? 'none on the Google listing or the website' : 'unknown'}.`);
  return L.join('\n');
}

/** The owner's own prices and contact details (order form) join the record the answers are judged against. */
export function addOwnerFacts(job: Job, truth: Truth, d?: BusinessDetails) {
  if (!d) return;
  const owner = 'the owner (order form)';
  for (const m of parseMenu(d.menu).filter((x) => x.price)) truth.siteFacts.push({ field: 'price', value: `${m.name}: ${m.price}`, quote: m.source, url: owner });
  if (d.whatsapp ?? d.phone) truth.siteFacts.push({ field: 'phone', value: (d.whatsapp ?? d.phone)!, quote: (d.whatsapp ?? d.phone)!, url: owner });
  if (d.address) truth.siteFacts.push({ field: 'address', value: d.address, quote: d.address, url: owner });
  if (d.menu) job.log('analyst', 'facts', `${parseMenu(d.menu).filter((x) => x.price).length} prices from the owner added to the record`);
}

const SPEC_FIELDS = '"name": the business name exactly as given, "website": domain or URL if given else "", "area": neighbourhood or district if given else "", "city": town or city, "country": country name in English, "countryIso": 2-letter ISO code, "category": the kind of business in 1-3 words, singular (e.g. "restaurant", "dentist", "hair salon"), "categoryPlural": its plural, "service": what customers most often look for there, 1-4 words (e.g. "jollof rice", "teeth whitening"), "priceItem": one specific product or service a customer would ask the price of, with an article (e.g. "a plate of jollof rice")';

/**
 * Researcher parses the brief; the order form's details are exact and override it (name, website, place).
 * `extra` adds fields to the parse for a service that needs more (it gets them back in `raw`).
 */
export async function readSpec(job: Job, brief: string, d?: BusinessDetails, extra?: { fields: string; dry: Record<string, unknown> }): Promise<{ spec: Spec; raw: Record<string, any> }> {
  job.log('researcher', 'parse', 'business, website, area, category, what customers look for');
  const parsed = parseJson<Record<string, any>>(
    await llm(job, 'researcher', [
      { role: 'system', content: `Parse a request to audit what AI assistants say about a local business. Reply JSON only: {${SPEC_FIELDS}${extra ? `, ${extra.fields}` : ''}}. Infer the country from the city when it is not stated.` },
      { role: 'user', content: brief },
    ], 'parse the audit request', { model: MODELS.fast, maxTokens: extra ? 400 : 300, json: true, dry: () => JSON.stringify({ ...fx.spec, ...extra?.dry }) }),
    {},
  );
  const spec: Spec = { name: '', website: '', area: '', city: '', country: '', countryIso: '', category: 'business', categoryPlural: '', service: '', priceItem: '' };
  for (const k of Object.keys(spec) as (keyof Spec)[]) if (typeof parsed[k] === 'string' && parsed[k]!.trim()) spec[k] = parsed[k]!.trim();
  if (d) {
    spec.name = d.name;
    if (d.website) spec.website = d.website;
    if (d.area) spec.area = d.area;
    if (d.city) spec.city = d.city;
  }
  if (!spec.name || !(spec.city || spec.area)) throw new Error('tell us the business name and its town or city');
  spec.countryIso = spec.countryIso.toUpperCase().slice(0, 2);
  spec.categoryPlural ||= `${spec.category}s`;
  spec.service ||= spec.category;
  spec.priceItem ||= `their most popular ${spec.service}`;
  return { spec, raw: parsed };
}

// ---------- 2. ask the assistants

function readAnswer(r: any): { text: string; cites: Cite[] } {
  const items: any[] = r?.items ?? [];
  const msgs = items.filter((i) => (i?.type ?? i?.message?.type) === 'message');
  const secs: any[] = (msgs.length ? msgs : items).flatMap((i) => i?.sections ?? i?.message?.sections ?? []);
  const text = secs.filter((s) => s?.text && s?.type !== 'summary_text').map((s) => String(s.text)).join('\n\n').trim();
  const cites: Cite[] = [];
  const add = (url?: string, title?: string) => {
    // Gemini's url is a Vertex redirect; the real page is direct_url, or at least the domain in the title
    if (url && /vertexaisearch|grounding-api-redirect/.test(url)) url = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(title ?? '') ? `https://${title}` : '';
    if (url && !cites.some((c) => c.url === url)) cites.push({ title: title || hostOf(url), url });
  };
  for (const s of secs) for (const a of s?.annotations ?? []) add(a?.direct_url ?? a?.url, a?.title);
  for (const m of text.matchAll(/https?:\/\/[^\s)\]>"']+/g)) add(m[0].replace(/[.,;]+$/, ''));
  return { text, cites };
}

type EngineState = { model: string; ok: boolean; fails: number; down: string };

async function ask(job: Job, e: Engine, agent: Role, p: Prompt, spec: Spec, st: EngineState): Promise<Answer> {
  const base = { id: `${e.id}:${p.kind}`, engine: e.id, label: e.label, prompt: p, text: '', cites: [], facts: [], missing: [], competitors: [] };
  if (st.down) return { ...base, model: st.model, error: `not asked: ${st.down}` };
  for (let attempt = 1; ; attempt++) {
    const geo = !noGeo.has(e.id);
    const task = Object.fromEntries(Object.entries({ user_prompt: p.text, model_name: st.model, ...e.body(spec, geo) }).filter(([, v]) => v !== undefined && v !== ''));
    try {
      job.log(agent, 'ask', `${e.label}: "${p.text}"`);
      const [r] = await dataforseo<any>(job, `ai_optimization/${e.path}/llm_responses/live`, task, {
        agent, vendor: `${e.label} (DataForSEO)`, reason: `ask ${e.label} a customer question (${p.kind})`, dry: () => fx.answer(e.id, p.kind),
      });
      st.ok = true;
      preferred[e.id] = st.model;
      const { text, cites } = readAnswer(r);
      return { ...base, model: String(r?.model_name ?? st.model), webSearch: r?.web_search, text, cites, error: text ? undefined : 'empty answer' };
    } catch (err) {
      const msg = errMsg(err);
      if (err instanceof SpendRefused) { st.down = 'the job budget is spent'; return { ...base, model: st.model, error: msg }; }
      // A call that failed after its payment was signed is never retried (see buy()); a rejected request is
      if (attempt === 1 && !/after the payment was signed/.test(msg)) {
        const next = e.models[e.models.indexOf(st.model) + 1];
        if (!st.ok && next && /model/i.test(msg)) { job.log(agent, 'switch', `${e.label} rejected ${st.model} (${msg.slice(0, 60)}); trying ${next}`); st.model = next; continue; }
        if (geo && /country|city|location/i.test(msg)) { noGeo.add(e.id); job.log(agent, 'switch', `${e.label} rejected the location settings; asking without them`); continue; }
      }
      st.fails++;
      if (!st.ok && st.fails >= 2) st.down = 'it failed twice in a row, so we stopped paying for it';
      job.log(agent, 'skip', `${e.label}: ${msg.slice(0, 90)}`);
      return { ...base, model: st.model, error: msg.slice(0, 200) };
    }
  }
}

// ---------- 3. compare with the record (maker), then deterministic checks

type Qa = { droppedFacts: number; droppedComps: number; unjudged: number };

async function judge(job: Job, spec: Spec, record: string, p: Prompt, batch: Answer[], qa: Qa, nextId: () => string) {
  const live = batch.filter((a) => a.text);
  if (!live.length) return;
  job.log('analyst', 'compare', `${live.length} answers to "${p.text.slice(0, 70)}"`);
  const rules = `You check what AI assistants told a customer about ${spec.name} against the business's record (its Google listing and website). For EACH answer return:
- "named": true only if the answer names ${spec.name} itself (not a different business with a similar name), and "name_quote": the words that name it, copied exactly.
- "facts": every checkable statement the answer makes about ${spec.name} itself (never about other businesses). One entry per statement: {"field": "hours"|"status"|"address"|"phone"|"website"|"price"|"deal"|"menu"|"delivery"|"rating"|"other", "quote": the answer's own words copied character for character (3-25 words, no paraphrase, no "..."), "claim": what it says in plain words, "verdict", "truth": what the record says ("" if nothing)}.
  verdict: "correct" = agrees with the record. "wrong" = contradicts the record (other hours, closed when the record shows it operating, another price or phone). "made_up" = a specific deal, discount, price, product, award or branch the record never mentions although it covers that topic (the record lists the website's prices and offers). "unverifiable" = the record says nothing either way.
  Hedged statements still count: "may be permanently closed" is a claim that it is closed. "I couldn't find X" is not a statement.
- "missing": ${p.expects.length ? `which of ${p.expects.join(', ')} the question asked for and the answer did not give` : 'always []'}.
- "competitors": names of other businesses the answer names or recommends, copied exactly as written, without markdown.
Reply JSON only: {"answers":[{"id","named","name_quote","facts":[...],"missing":[...],"competitors":[...]}]}`;
  let out: { answers?: any[] } = {};
  try {
    out = parseJson(await llm(job, 'analyst', [
      { role: 'system', content: rules },
      { role: 'user', content: `${record}\n\nQUESTION the customer asked: "${p.text}"\n\n` + live.map((a) => `=== ANSWER id=${a.id} (${a.label})\n${a.text.slice(0, 4000)}`).join('\n\n') },
    ], `check ${live.length} answers against the record`, { maxTokens: 2500, json: true, dry: () => JSON.stringify(fx.judge(p.kind)) }), {});
  } catch (e) { job.log('analyst', 'skip', `compare failed (${errMsg(e).slice(0, 60)})`); }

  const drop = [...GENERIC, ...words(spec.area), ...words(spec.city)];
  for (const a of live) {
    const j = (out.answers ?? []).find((x) => x?.id === a.id);
    if (!j) { qa.unjudged++; continue; }
    for (const f of j.facts ?? []) {
      const quote = locate(a.text, String(f?.quote ?? ''));
      if (!quote) { qa.droppedFacts++; continue; }
      if (!['correct', 'wrong', 'made_up', 'unverifiable'].includes(f.verdict)) continue;
      a.facts.push({ id: nextId(), field: field(f.field), quote, claim: String(f.claim ?? ''), verdict: f.verdict, truth: String(f.truth ?? '') });
    }
    const comps: string[] = [];
    for (const c of j.competitors ?? []) {
      const hit = locate(a.text, String(c ?? '').replace(/[*_]/g, ''));
      if (!hit) { qa.droppedComps++; continue; }
      if (nameScore(hit, spec.name, drop) < 0.6 && !plain(hit).includes(plain(spec.name))) comps.push(hit);
    }
    a.competitors = uniq(comps);
    if (p.type === 'discovery') {
      const nq = locate(a.text, spec.name) ?? (j.named ? locate(a.text, String(j.name_quote ?? '')) : undefined);
      a.named = !!nq && nameScore(nq, spec.name, drop) >= 0.6;
      if (a.named) {
        const order = [nq!, ...a.competitors].map((n) => ({ n, i: a.text.indexOf(n) })).sort((x, y) => x.i - y.i);
        a.rank = [order.findIndex((o) => o.n === nq) + 1, order.length];
      }
    }
    const covered = (m: string) => a.facts.some((f) => f.field === m || (m === 'price' && f.field === 'menu'));
    a.missing = uniq<string>((j.missing ?? []).map(field)).filter((m) => p.expects.includes(m) && !covered(m));
  }
}

// ---------- 4. independent audit: blind re-judge on another model family, two keys to count

async function audit(job: Job, record: string, answers: Answer[]): Promise<{ ok: boolean; agreed: number; total: number }> {
  const items = answers.flatMap((a) => a.facts.map((f) => ({ a, f })));
  if (!items.length) return { ok: true, agreed: 0, total: 0 };
  job.log('auditor', 'audit', `re-judging ${items.length} statements blind with ${MODELS.auditor}`);
  const excerpt = (a: Answer, f: Fact) => { const i = a.text.indexOf(f.quote); return a.text.slice(Math.max(0, i - 160), i + f.quote.length + 160).replace(/\s+/g, ' '); };
  let checks: { id: string; verdict: string; note?: string }[] = [];
  try {
    checks = parseJson<{ checks?: typeof checks }>(await llm(job, 'auditor', [
      { role: 'system', content: 'You are an independent fact-checker. AI assistants made the statements below about a local business. Judge each one yourself against the RECORD, using the excerpt for context: "correct" (agrees with the record), "wrong" (the record clearly contradicts it), "made_up" (a specific deal, discount, price, product, award or branch the record never mentions although it covers that topic), "unverifiable" (the record says nothing either way). A hedge like "may be closed" is still a claim. Reply JSON only: {"checks":[{"id","verdict","note": short reason}]}, one per item.' },
      { role: 'user', content: `${record}\n\nITEMS:\n${JSON.stringify(items.map(({ a, f }) => ({ id: f.id, assistant: a.label, question: a.prompt.text, field: f.field, statement: f.quote, excerpt: excerpt(a, f) })))}` },
    ], `independently re-judge ${items.length} statements`, { model: MODELS.auditor, maxTokens: 2500, json: true,
      dry: () => JSON.stringify(fx.audit(items.map(({ a, f }) => ({ id: f.id, engine: a.engine, field: f.field, verdict: f.verdict })))) }), {}).checks ?? [];
  } catch (e) { job.log('auditor', 'skip', `audit failed (${errMsg(e).slice(0, 60)})`); }
  if (!checks.length) {
    for (const { f } of items) f.final = f.verdict;
    return { ok: false, agreed: 0, total: items.length };
  }
  const byId = new Map(checks.map((c) => [String(c.id), c]));
  let agreed = 0;
  for (const { f } of items) {
    const c = byId.get(f.id);
    if (c?.verdict === f.verdict) { f.final = f.verdict; agreed++; }
    else { f.final = 'disputed'; f.auditNote = c ? `the auditor says ${String(c.verdict).replace('_', '-')}${c.note ? `: ${c.note}` : ''}` : 'the auditor gave no verdict'; }
  }
  return { ok: true, agreed, total: items.length };
}

// ---------- 5. optional: how often AI answers already cite the site (DataForSEO's LLM Mentions database)

async function mentions(job: Job, spec: Spec, t: Truth) {
  if (!t.domain) return undefined;
  const us = spec.countryIso === 'US';
  const scope = us ? 'ChatGPT answers in the United States' : `Google AI Overviews in ${spec.country}`;
  try {
    job.log('scout', 'mentions', `${t.domain} in DataForSEO's database of ${scope}`);
    const [r] = await dataforseo<any>(job, 'ai_optimization/llm_mentions/search/live', {
      target: [{ domain: t.domain }], platform: us ? 'chat_gpt' : 'google', location_name: us ? 'United States' : spec.country, language_code: 'en', limit: 5,
    }, { agent: 'scout', vendor: 'LLM Mentions (DataForSEO)', reason: `how often AI answers cite ${t.domain}`, dry: fx.mentions });
    return { scope, total: Number(r?.total_count ?? 0), questions: (r?.items ?? []).map((i: any) => String(i?.question ?? '')).filter(Boolean).slice(0, 3) as string[] };
  } catch (e) {
    job.log('scout', 'skip', `LLM Mentions failed (${errMsg(e).slice(0, 60)})`);
    return undefined;
  }
}

// ---------- 6. the report

export type Tally = { name: string; count: number; by: Set<string>; url?: string };
function tallyNames(answers: Answer[]): Tally[] {
  const out: Tally[] = [];
  for (const a of answers) for (const c of a.competitors) {
    const hit = out.find((x) => nameScore(x.name, c) >= 0.5 || plain(x.name).includes(plain(c)) || plain(c).includes(plain(x.name)));
    if (hit) { hit.count++; hit.by.add(a.label); } else out.push({ name: c, count: 1, by: new Set([a.label]) });
  }
  return out.sort((a, b) => b.count - a.count);
}
function tallySources(answers: Answer[], own?: string): Tally[] {
  const out = new Map<string, Tally>();
  for (const a of answers) for (const c of a.cites) {
    const h = hostOf(c.url);
    if (!h || h === own) continue;
    const x = out.get(h) ?? { name: h, count: 0, by: new Set<string>(), url: c.url };
    x.count++; x.by.add(a.label);
    out.set(h, x);
  }
  return [...out.values()].sort((a, b) => b.count - a.count);
}

const counted = (answers: Answer[], v: Verdict) => answers.flatMap((a) => a.facts.filter((f) => f.final === v).map((f) => ({ a, f })));

/** One fix, keyed so a service that merges fix lists (Get Found) can drop the ones it covers itself. */
export type Fix = { key: string; rank: number; text: string };

function fixList(spec: Spec, t: Truth, answered: Answer[], sources: Tally[], rivals: Tally[]): Fix[] {
  const bad = [...counted(answered, 'wrong'), ...counted(answered, 'made_up')];
  const pick = (fields: string[], v: Verdict) => bad.filter((x) => x.f.final === v && fields.includes(x.f.field));
  const said = (xs: typeof bad) => xs.slice(0, 2).map(({ a, f }) => `${a.label} said “${shown(f.quote)}”`).join('; ');
  const leaned = (xs: typeof bad) => {
    const hs = uniq(xs.flatMap((x) => x.a.cites.map((c) => hostOf(c.url)))).filter((h) => h && h !== t.domain && !/google\./.test(h));
    return hs.length ? ` Those answers cited ${hs.slice(0, 3).join(', ')}: correct or remove the old details there too.` : '';
  };
  const site = (field: string) => t.siteFacts.find((f) => f.field === field);
  const disc = answered.filter((a) => a.prompt.type === 'discovery');
  const named = disc.filter((a) => a.named).length;
  const F: Fix[] = [];
  const add = (rank: number, key: string, text: string) => F.push({ rank, key, text });

  if (!t.listing) add(0, 'listing', `**Get on Google Maps.** We found no Google listing for ${spec.name}. Create and verify a Google Business Profile with your address, phone, hours and photos: it is the first place assistants look for local facts.`);
  const status = pick(['status'], 'wrong');
  if (status.length) add(1, 'status', `**Stop the "closed" story.** ${said(status)}, but Google shows you as ${t.status?.split(' (')[0] ?? 'operating'}. Post an update and fresh photos on your Google profile this week, and put "We're open" with your hours as text on your homepage.${leaned(status)}`);
  const hours = pick(['hours'], 'wrong');
  if (hours.length) add(2, 'hours', `**Fix your opening hours everywhere.** ${said(hours)}. Your Google listing says ${t.hours ? shortHours(t.hours) : 'nothing (add them)'}. ${site('hours') ? `Your website says “${site('hours')!.quote}”.` : "Your website doesn't state your hours: add them as plain text on the homepage and contact page."}${leaned(hours)}`);
  if (t.conflicts.length) add(2, 'conflict', `**Make your website and Google listing agree.** ${t.conflicts.map((c) => `Your website says “${c.quote}” but Google says ${c.google}`).join('; ')}. Assistants read both, and when they disagree they pick one or guess. Update whichever is out of date.`);
  const contact = pick(['phone', 'address', 'website'], 'wrong');
  if (contact.length) add(3, 'contact', `**Correct your contact details.** ${said(contact)}. Your listing has ${[t.address, t.phones[0]].filter(Boolean).join(', ')}.${leaned(contact)}`);
  const made = bad.filter((x) => x.f.final === 'made_up');
  const prices = [...pick(['price', 'menu', 'delivery', 'rating', 'other'], 'wrong'), ...made];
  if (prices.length) {
    const p = site('price');
    add(4, 'prices', `**Publish your real prices and offers as text.** ${said(prices)}. ${p ? `Your prices are on ${p.url}: link that page from your homepage, title it "Prices" or "Menu & prices", and keep it current.` : 'Your website shows no prices: add a simple prices page as text, not a photo of a menu.'} Say plainly which deals you run${made.length ? ', so nobody turns up expecting one you never offered' : ''}.`);
  }
  if (t.claimed === false) add(5, 'claim', '**Claim your Google Business Profile.** Google shows it as unclaimed, so anyone can suggest changes to your hours and details and nobody asks you first. Claim it at business.google.com and check every field.');
  const gaps = answered.filter((a) => a.missing.length);
  if (gaps.length) add(6, 'basics', `**Put the basics where assistants can read them.** ${gaps.length} answer${gaps.length > 1 ? 's' : ''} couldn't say: ${asked(uniq(gaps.flatMap((a) => a.missing)))}. Put hours, phone, address and prices as plain text on your homepage and contact page, and add schema.org LocalBusiness markup (openingHours, telephone, address, priceRange) so machines read them without guessing.`);
  if (!t.domain) add(6, 'website', `**Get a simple website.** ${t.social ? 'You only have a social-media page, which assistants rarely read.' : 'We found no website.'} One page with your hours, phone, address, prices and a map link gives assistants something to quote.`);
  const third = sources.filter((s) => !/google\.|goo\.gl/.test(s.name)).slice(0, 5);
  if (disc.length && named < disc.length && third.length) add(7, 'sources', `**Get onto the pages the assistants read.** You were named in ${named} of ${disc.length} "which ${spec.category}?" answers. The pages they cited in those answers: ${third.map((s) => `${s.name} (${s.count}×)`).join(', ')}. Ask to be added to their lists and reviews, and make sure any listing of yours there is complete and correct.`);
  if (rivals.length) add(8, 'reviews', `**Earn reviews that say what you're known for.** The assistants recommended ${rivals.slice(0, 3).map((r) => `${r.name} (${r.count}×)`).join(', ')} instead. Ask happy customers to mention "${spec.service}" and "${spec.area || spec.city}" in their Google reviews${t.topics.length ? `; today your reviews mostly talk about ${t.topics.slice(0, 3).join(', ')}` : ''}.`);
  return F.sort((a, b) => a.rank - b.rank);
}

function resultCell(a: Answer): string {
  if (!a.text) return a.error?.startsWith('not asked') ? `Not asked (${a.error.slice(11)})` : 'No answer (the call failed)';
  const right = a.facts.filter((f) => f.final === 'correct').length;
  const wrong = a.facts.filter((f) => f.final === 'wrong').map((f) => f.field);
  const made = a.facts.filter((f) => f.final === 'made_up').map((f) => f.field);
  const parts = [
    a.prompt.type === 'discovery' ? (a.named ? `**Named you** (#${a.rank?.[0]} of ${a.rank?.[1]})` : 'Not named') : '',
    right ? `✓ ${right} right` : '',
    wrong.length ? `✗ wrong: ${uniq(wrong).join(', ')}` : '',
    made.length ? `? not in your records: ${uniq(made).join(', ')}` : '',
    a.missing.length ? `couldn't say: ${asked(a.missing)}` : '',
  ].filter(Boolean);
  return parts.join('; ') || 'No checkable facts';
}

// ---------- 7. the audit as a step any service can run

export const STANDARD_KINDS: Kind[] = ['hours', 'status', 'price', 'best', 'service', 'recommend'];
type Hit = { a: Answer; f: Fact };
type Lines = (h: string) => string[];

export type AuditResult = {
  where: string; record: string; prompts: Prompt[]; answers: Answer[]; answered: Answer[];
  disc: Answer[]; named: Answer[]; wrong: Hit[]; made: Hit[]; right: Hit[]; disputed: Hit[]; unanswered: Answer[]; worst?: Hit;
  rivals: Tally[]; sources: Tally[]; ownCites: number; seen?: { scope: string; total: number; questions: string[] };
  aud: { ok: boolean; agreed: number; total: number };
  fixes: Fix[]; // every fix, most urgent first (the AI Answer Audit prints the first 8)
  issues: string[]; hardFail: boolean; literal: boolean; unjudged: number; // deterministic QA: answers back, quotes word for word, auditor agreement
  /** Report sections; `h` is the heading prefix ('##' on its own, '###' inside a bigger report). */
  md: { stats: string; scorecard: Lines; wrongFacts: Lines; madeUp: Lines; unanswered: Lines; rivals: Lines; sources: Lines; detail: Lines; record: Lines; method: string[] };
  files: { name: string; content: string }[]; // answers.csv, ai-answers.md
};

/**
 * Ask the assistants and check every answer against the record: (optional) LLM Mentions → the questions,
 * two lanes → analyst per question → verbatim quote checks → blind audit on another model family → numbers,
 * rule-based fixes and report sections. `kinds` picks the standard questions; the owner's own question from
 * the order form is always asked.
 */
export async function auditAnswers(job: Job, spec: Spec, truth: Truth, d?: BusinessDetails, opts: { kinds?: Kind[]; mentions?: boolean } = {}): Promise<AuditResult> {
  const where = place(spec);
  const record = recordText(spec, truth);
  const seen = opts.mentions === false ? undefined : await mentions(job, spec, truth);

  // What customers ask: questions about the business by name, and ones where it has to be recommended
  const kinds = opts.kinds ?? STANDARD_KINDS;
  const prompts: Prompt[] = ([
    { kind: 'hours', type: 'direct', text: `What are the opening hours of ${spec.name} in ${where}?`, expects: ['hours'] },
    { kind: 'status', type: 'direct', text: `Is ${spec.name} in ${where} still open? What are their opening hours, address and phone number?`, expects: ['status', 'hours', 'address', 'phone'] },
    { kind: 'price', type: 'direct', text: `How much does ${spec.name} in ${where} charge for ${spec.priceItem}? Do they have any deals or discounts at the moment?`, expects: ['price', 'deal'] },
    { kind: 'best', type: 'discovery', text: `What's the best ${spec.category} in ${where}?`, expects: [] },
    { kind: 'service', type: 'discovery', text: `Where can I get ${spec.service} near ${where}?`, expects: [] },
    { kind: 'recommend', type: 'discovery', text: `Can you recommend a few good ${spec.categoryPlural} in ${where}?`, expects: [] },
  ] as Prompt[]).filter((p) => kinds.includes(p.kind));
  // the customer's own question from the order form, asked about the business by name
  if (d?.questions) prompts.push({ kind: 'custom', type: 'direct', text: `About ${spec.name} in ${where}: ${d.questions.split('\n')[0].trim().slice(0, 160)}`, expects: ['other'] });
  job.log('researcher', 'plan', `${prompts.length} questions, ${prompts.reduce((t, p) => t + enginesFor(p).length, 0)} answers from ${ENGINES.length} assistants, web search on`);

  // Two lanes ask; the analyst checks each question as soon as all four answers to it are in
  const states = new Map(ENGINES.map((e) => [e.id, { model: preferred[e.id] ?? e.models[0], ok: false, fails: 0, down: '' } as EngineState]));
  const pending = new Map<string, Promise<Answer>>();
  for (const lane of LANES) {
    let prev: Promise<unknown> = Promise.resolve();
    for (const p of prompts) for (const id of lane.engines) {
      const e = ENGINES.find((x) => x.id === id);
      if (!e || !enginesFor(p).includes(e)) continue;
      const next = prev.then(() => ask(job, e, lane.agent, p, spec, states.get(id)!));
      pending.set(`${id}:${p.kind}`, next);
      prev = next;
    }
  }
  const qa: Qa = { droppedFacts: 0, droppedComps: 0, unjudged: 0 };
  let n = 0;
  const answers: Answer[] = [];
  for (const p of prompts) {
    const batch = await Promise.all(enginesFor(p).map((e) => pending.get(`${e.id}:${p.kind}`)!));
    answers.push(...batch);
    await judge(job, spec, record, p, batch, qa, () => `F${++n}`);
  }
  const answered = answers.filter((a) => a.text);
  job.log('analyst', 'checked', `${answered.length}/${answers.length} answers; ${qa.droppedFacts} statements and ${qa.droppedComps} names dropped (not word for word in the answer)`);

  // Independent audit
  const aud = await audit(job, record, answered);

  // Numbers, fixes, deterministic QA
  const disc = answered.filter((a) => a.prompt.type === 'discovery');
  const named = disc.filter((a) => a.named);
  const wrong = counted(answered, 'wrong'), made = counted(answered, 'made_up'), right = counted(answered, 'correct'), disputed = counted(answered, 'disputed' as Verdict);
  const unanswered = answered.filter((a) => a.missing.length);
  const rivals = tallyNames(disc);
  const sources = tallySources(answered, truth.domain);
  const ownCites = answered.reduce((s, a) => s + a.cites.filter((c) => truth.domain && hostOf(c.url) === truth.domain).length, 0);
  const discSources = tallySources(disc, truth.domain);
  const fixes = fixList(spec, truth, answered, discSources.length ? discSources : sources, rivals);

  const literal = answered.every((a) => a.facts.every((f) => a.text.includes(f.quote)) && a.competitors.every((c) => a.text.includes(c)));
  const issues = [
    answered.length < answers.length ? `${answered.length} of ${answers.length} answers came back (${ENGINES.map((e) => [e.label, answers.filter((a) => a.engine === e.id && !a.text).length] as const).filter(([, k]) => k).map(([l, k]) => `${l}: ${k} missing`).join(', ')})` : '',
    qa.droppedFacts ? `${nOf(qa.droppedFacts, 'analyst statement')} dropped: quote not word for word in the answer` : '',
    qa.droppedComps ? `${nOf(qa.droppedComps, 'competitor name')} dropped: not in the answer` : '',
    qa.unjudged ? `${nOf(qa.unjudged, 'answer')} the analyst did not return` : '',
    aud.ok ? `auditor agreed on ${aud.agreed} of ${aud.total} statements; ${disputed.length} disputed and left out of the score` : 'the independent auditor did not answer; wrong facts are the analyst\'s alone',
    literal ? '' : 'a printed quote or name is not in its answer',
  ].filter(Boolean);
  const hardFail = answered.length < answers.length / 2 || !literal;
  job.log('auditor', 'check', `${hardFail ? 'FAIL' : 'pass'}: ${issues.join('; ')}`);
  const worst = [...wrong.filter((x) => x.f.field === 'status'), ...wrong.filter((x) => x.f.field === 'hours'), ...wrong, ...made][0];

  // Report sections
  const models = ENGINES.map((e) => { const a = answered.find((x) => x.engine === e.id); return a ? `${e.label} (${a.model})` : `${e.label} (no answers)`; });
  const md: AuditResult['md'] = {
    stats: `**Named in ${named.length} of ${disc.length} recommendation answers · ${wrong.length} wrong fact${wrong.length === 1 ? '' : 's'} · ${made.length} claim${made.length === 1 ? '' : 's'} not found in your records · ${unanswered.length} question${unanswered.length === 1 ? '' : 's'} left unanswered**`,
    scorecard: (h) => {
      const L = [`${h} Scorecard`, '', '| Assistant | Named you when asked for a recommendation | Facts right | Wrong | Not in your records | Answers missing basics | Web search used |', '|---|---|---|---|---|---|---|'];
      for (const e of ENGINES) {
        const as = answered.filter((a) => a.engine === e.id);
        const f = (v: Verdict) => as.reduce((s, a) => s + a.facts.filter((x) => x.final === v).length, 0);
        const dd = as.filter((a) => a.prompt.type === 'discovery');
        if (!as.length) { L.push(`| ${e.label} | no answers this run | — | — | — | — | — |`); continue; }
        L.push(`| ${e.label} (${as[0].model}) | ${dd.filter((a) => a.named).length} of ${dd.length} | ${f('correct')} | ${f('wrong')} | ${f('made_up')} | ${as.filter((a) => a.missing.length).length} | ${as.filter((a) => a.webSearch).length} of ${as.length} |`);
      }
      return [...L, ''];
    },
    wrongFacts: (h) => !wrong.length ? [] : [`${h} Wrong facts`, '', 'Each quote is copied word for word from the assistant\'s answer (all answers are in `ai-answers.md`).', '', '| Assistant | Question | What it said | What your records say |', '|---|---|---|---|',
      ...wrong.map(({ a, f }) => `| ${a.label} | ${cell(a.prompt.text)} | “${cell(shown(f.quote))}” | ${cell(f.truth || '—')} |`), ''],
    madeUp: (h) => !made.length ? [] : [`${h} Claims we could not find anywhere in your listing or website`, '', 'If you don\'t offer these, the assistant made them up, and customers may turn up expecting them.', '', '| Assistant | What it said | What your records say |', '|---|---|---|',
      ...made.map(({ a, f }) => `| ${a.label} | “${cell(shown(f.quote))}” | ${cell(f.truth || 'Not mentioned')} |`), ''],
    unanswered: (h) => !unanswered.length ? [] : [`${h} Questions the assistants could not answer`, '', ...unanswered.map((a) => `- **${a.label}** couldn't say: ${asked(a.missing)} (asked “${a.prompt.text}”)`), ''],
    rivals: (h) => [`${h} Who the assistants recommend instead`, '',
      ...(rivals.length ? ['| Business | Recommendation answers naming them | By |', '|---|---|---|', ...rivals.slice(0, 10).map((r) => `| ${cell(r.name)} | ${r.count} | ${[...r.by].join(', ')} |`)] : ['No other businesses were named.']),
      ...(truth.alsoSearch.length ? ['', `For comparison, Google's own "People also search for" on your listing: ${truth.alsoSearch.join(', ')}.`] : []), ''],
    sources: (h) => [`${h} Where the assistants get their answers`, '', 'The pages the assistants cited. Being listed, and described correctly, on these is how a business gets into the answers.', '',
      ...(sources.length ? ['| Site | Times cited | By | Example page |', '|---|---|---|---|', ...sources.slice(0, 12).map((s) => `| ${s.name} | ${s.count} | ${[...s.by].join(', ')} | ${s.url} |`)] : ['No sources were cited.']),
      ...(truth.domain ? ['', `Your own site (${truth.domain}) was cited ${ownCites} time${ownCites === 1 ? '' : 's'}.`] : []),
      ...(seen ? ['', `Beyond this snapshot: DataForSEO's database of ${seen.scope} has **${seen.total}** answer${seen.total === 1 ? '' : 's'} citing ${truth.domain}${seen.questions.length ? `, e.g. for “${seen.questions.join('”, “')}”` : ''}.`] : []), ''],
    detail: (h) => {
      const L = [`${h} Answer by answer`, ''];
      for (const e of ENGINES) {
        const as = answers.filter((a) => a.engine === e.id);
        const m = as.find((a) => a.text)?.model;
        L.push(`${h}# ${e.label}${m ? ` · ${m}` : ''}`, '', '| Question | Result | Recommended instead | Sources cited |', '|---|---|---|---|');
        for (const a of as) L.push(`| ${cell(a.prompt.text)} | ${cell(resultCell(a))} | ${cell(a.competitors.join(', ') || '—')} | ${cell(uniq(a.cites.map((c) => hostOf(c.url))).slice(0, 3).join(', ') || '—')} |`);
        L.push('');
      }
      return L;
    },
    record: (h) => {
      const L = [`${h} Your record (what we checked against)`, ''];
      if (truth.listing) {
        L.push(`- **Google listing:** ${truth.name}${truth.category ? `, ${truth.category}` : ''}`, `- **Address:** ${truth.address ?? 'not listed'}`, `- **Phone:** ${truth.phones.join(' / ') || 'not listed'}`,
          `- **Hours:** ${shortHours(truth.hours)}`, `- **Status:** ${truth.status ?? 'listed, no closure notice seen'}`,
          `- **Rating:** ${truth.rating ? `${truth.rating} (${truth.reviews ?? '?'} reviews)` : 'none'}${truth.claimed === undefined ? '' : ` · profile ${truth.claimed ? 'claimed' : '**not claimed**'}`}`);
        if (truth.topics.length) L.push(`- **What your reviews mention most:** ${truth.topics.join(', ')}`);
      } else L.push('- **Google listing:** none found');
      if (truth.siteRead) {
        L.push(`- **Website (${truth.domain}):**`);
        for (const f of truth.siteFacts) L.push(`  - ${f.field}: “${cell(f.quote)}” (${f.url})`);
      } else L.push(`- **Website:** ${truth.domain ? `${truth.domain} could not be read` : truth.social ? 'only a social-media page' : 'none'}`);
      return [...L, ''];
    },
    method: [
      `- ${prompts.length} questions a customer would ask, put to ${ENGINES.length} assistants through their APIs on ${today()} with web search on: ${models.join(', ')}. Questions asked by name: ${prompts.filter((p) => p.type === 'direct').length}; recommendation questions: ${prompts.filter((p) => p.type === 'discovery').length}.`,
      '- The truth is your Google listing (via Google Maps and your Google Business Profile) and your own website, read the same day. If those are out of date, an assistant can look "wrong" while being right; the fix is the same: make your records correct.',
      `- One model compared every statement with your record. Every quote had to appear word for word in the saved answer, and every business named as a competitor had to appear in it too. ${aud.ok ? `A second model from a different company (${MODELS.auditor}) then judged every statement again without seeing the first verdict. A statement counts as wrong or not-found only when both agree.` : `The second, independent check (${MODELS.auditor}) did not run this time, so the wrong and not-found statements are the first model's judgement only: verify them against your records before acting.`}`,
      ...(disputed.length ? [`- ${disputed.length} statement${disputed.length === 1 ? '' : 's'} where the two checkers disagreed, left out of the score: ${disputed.map(({ a, f }) => `${a.label} “${cell(shown(f.quote))}” (${f.auditNote})`).join('; ')}.`] : []),
      '- **Honest limits:** assistants give different answers from run to run, to different wordings, in different places and to different accounts, and the consumer apps can differ from their APIs. This is a snapshot, not a guarantee. Re-run it after you make the fixes.',
    ],
  };

  // Files: one row per answer, and every answer in full
  const header = ['engine', 'model', 'web_search', 'question_type', 'prompt', 'named_business', 'facts_checked', 'correct_facts', 'wrong_facts', 'not_in_records', 'unanswered', 'competitors', 'cited_urls', 'answer'];
  const rows = answers.map((a) => {
    const fs = (v: Verdict) => a.facts.filter((f) => f.final === v);
    return [a.label, a.model, a.webSearch === undefined ? '' : a.webSearch ? 'yes' : 'no', a.prompt.type, a.prompt.text,
      a.prompt.type === 'discovery' ? (a.text ? (a.named ? 'yes' : 'no') : '') : 'asked by name',
      a.facts.filter((f) => f.final !== 'disputed').length, fs('correct').length,
      fs('wrong').map((f) => `${f.field}: "${shown(f.quote)}" (record: ${f.truth})`).join(' | '),
      fs('made_up').map((f) => `${f.field}: "${shown(f.quote)}"`).join(' | '),
      a.missing.join(' | '), a.competitors.join(' | '), a.cites.map((c) => c.url).join(' '), a.text || `(${a.error ?? 'no answer'})`].map(csvCell).join(',');
  });
  const T = [`# Every answer, in full: ${spec.name}, ${today()}`, ''];
  for (const p of prompts) {
    T.push(`## “${p.text}”`, '');
    for (const a of answers.filter((x) => x.prompt.kind === p.kind)) {
      T.push(`### ${a.label}${a.text ? ` · ${a.model} · web search ${a.webSearch ? 'used' : 'not used'}` : ''}`, '');
      T.push(a.text ? a.text.split('\n').map((l) => `> ${l}`).join('\n') : `_${a.error ?? 'no answer'}_`, '');
      if (a.cites.length) T.push('Sources:', ...a.cites.map((c) => `- ${c.title} — ${c.url}`), '');
    }
  }
  const files = [{ name: 'answers.csv', content: [header.join(','), ...rows].join('\n') + '\n' }, { name: 'ai-answers.md', content: T.join('\n') }];

  return { where, record, prompts, answers, answered, disc, named, wrong, made, right, disputed, unanswered, worst, rivals, sources, ownCites, seen, aud, fixes, issues, hardFail, literal, unjudged: qa.unjudged, md, files };
}

// ---------- the service (off the menu; Get Found runs the same audit; old orders can still be revised)

export const aiAnswerAudit = {
  id: 'ai-answer-audit',
  name: 'AI Answer Audit',
  priceUsd: 15,
  // 24 answers at 0.10 + Business Profile 0.10 + LLM Mentions 0.10 + Maps, site and ~10 LLM calls ≈ 2.75;
  // headroom covers a model fallback or two. Answers cap at 0.15 each (sellers.ts default).
  policy: { budgetUsd: 4 + MAIL_BUDGET_USD, allowHosts: [HOSTS.blockrun, HOSTS.blockrunArc, HOSTS.orthogonal, HOSTS.apex, HOSTS.exa, AISA, ...(MAIL_HOST ? [MAIL_HOST] : [])] },

  async run(brief: string, opts: { orderId?: string; details?: BusinessDetails } = {}): Promise<Job> {
    const job = new Job(this.id, brief, this.policy, opts.orderId);
    try {
      const d = opts.details;
      const { spec } = await readSpec(job, brief, d);
      const truth = await gatherTruth(job, spec);
      addOwnerFacts(job, truth, d);
      const r = await auditAnswers(job, spec, truth, d);
      const { where, disc, named, wrong, made, unanswered, worst, rivals } = r;
      job.qa = { verdict: r.hardFail || !r.aud.ok ? 'revise' : 'pass', notes: r.issues.join(' | '), model: `${MODELS.auditor} (blind re-judge) + deterministic quote checks` };

      // Writer: a plain-English summary. Every number in it must come from the data we hand over.
      const facts = { business: spec.name, area: where, category: spec.category, discovery_answers: disc.length, named_in: named.length, wrong_facts: wrong.length,
        claims_not_in_records: made.length, questions_left_unanswered: unanswered.length,
        most_harmful: worst ? { assistant: worst.a.label, said: shown(worst.f.quote), truth: worst.f.truth } : null,
        recommended_instead: rivals.slice(0, 3).map((x) => ({ name: x.name, times: x.count })) };
      job.log('writer', 'summary', 'plain-English summary for the owner');
      let summary = '';
      try {
        summary = (await llm(job, 'writer', [
          { role: 'system', content: 'Write 3 short sentences for a small-business owner about what AI assistants tell their customers. Plain words, no jargon, no hype, no advice (a fix list follows). Use only the facts given; never add a number that is not in them. Mention the most harmful wrong statement if there is one, and who is recommended instead. Reply with the sentences only.' },
          { role: 'user', content: JSON.stringify(facts) },
        ], 'write the summary', { maxTokens: 300, dry: fx.summary })).trim();
      } catch (e) { job.log('writer', 'skip', `summary failed (${errMsg(e).slice(0, 50)})`); }
      const given = JSON.stringify(facts);
      if (!summary || !(summary.match(/\d[\d,.:]*\d|\d/g) ?? []).every((x) => given.includes(x))) {
        if (summary) job.log('writer', 'redo', 'the summary used a number that is not in the data; using the plain version');
        summary = `${spec.name} was named in ${named.length} of ${disc.length} answers where customers asked AI assistants to recommend a ${spec.category} in ${where}${rivals[0] ? `; ${rivals[0].name} was named ${rivals[0].count} times` : ''}. ` +
          `Asked about you by name, the assistants stated ${wrong.length} wrong fact${wrong.length === 1 ? '' : 's'}${worst ? ` (${worst.a.label}: “${shown(worst.f.quote)}”)` : ''} and ${made.length} claim${made.length === 1 ? '' : 's'} we could not find anywhere in your listing or website.`;
      }

      const fixes = r.fixes.slice(0, 8).map((f) => f.text);
      const L = [`# What AI assistants tell customers about ${spec.name}`, '', `${spec.name} · ${spec.category} · ${where} · snapshot taken ${today()}`, '', r.md.stats, '', summary, '',
        ...r.md.scorecard('##'), ...r.md.wrongFacts('##'), ...r.md.madeUp('##'), ...r.md.unanswered('##'), ...r.md.rivals('##'), ...r.md.sources('##'),
        '## Fix list, most urgent first', '', ...(fixes.length ? fixes.map((x, i) => `${i + 1}. ${x}`) : ['Nothing urgent: the assistants got your facts right. Re-check in a month; answers change.']), '',
        ...r.md.detail('##'), ...r.md.record('##'),
        '## How this audit was done', '', ...r.md.method, '', 'Files: `answers.csv` (one row per answer), `ai-answers.md` (every answer in full, with its sources).'];
      if (r.issues.length) L.push('', `> QA notes: ${r.issues.join('; ')}.`);
      job.deliverable = L.join('\n');
      job.files.push(...r.files);

      job.status = r.hardFail ? 'failed' : 'delivered';
      if (r.hardFail) job.error = `QA failed: ${r.issues.join('; ')}`;
    } catch (e: any) {
      job.status = 'failed';
      job.error = errMsg(e);
      console.error('  ✗', job.error);
    }
    job.save();
    return job;
  },
};
