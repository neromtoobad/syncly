// Paid tools on Arc mainnet (x402 via Circle Gateway). Prices are the listed amounts from
// Circle's discovery API on 2026-09-22/27; each call is capped a little above list.
import { buy, NoWalletFunds, SpendRefused } from './x402.ts';
import { MODELS } from './config.ts';
import type { Job } from './job.ts';
import type { Role } from './wallets.ts';

export const HOSTS = {
  blockrun: 'nano.blockrun.ai',
  blockrunArc: 'arc.blockrun.ai', // newest models; paid by direct USDC transfer from the agent's wallet
  orthogonal: 'np.orthogonal.com',
  exa: 'api.exa.ai',
  apex: 'apexfaucet.xyz',
  stb: 'x402.spendthebits.com',
} as const;

const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();
/** APEX wraps its answer as { ok, paid, data: { results | pages | … } }; older replies were flat. */
const apex = (d: any) => (d?.data && typeof d.data === 'object' && !Array.isArray(d.data) ? d.data : d);
const list = (...xs: unknown[]): any[] => (xs.find(Array.isArray) as any[]) ?? [];
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

// ---------- APEX (GET, query params)

/** Up to 10 pages as clean text, $0.003 per call. Cheaper than Exa for site crawls. */
export async function webRead(job: Job, agent: Role, urls: string[], reason: string): Promise<Page[]> {
  const out: Page[] = [];
  for (let i = 0; i < urls.length; i += 10) {
    const batch = urls.slice(i, i + 10);
    const data = await buy<any>(job, {
      agent, vendor: 'APEX web-read', url: `https://${HOSTS.apex}/api/x402/web-read?${qs({ urls: batch.join(',') })}`, method: 'GET',
      reason, expectUsd: 0.003, maxUsd: 0.006,
      dryData: () => ({ pages: batch.map((u, k) => ({ url: u, title: `Site ${u}`, text: k % 2 ? `Contact us: hello@${new URL(u).host}` : 'No email here.' })) }),
    });
    const d = apex(data);
    for (const p of list(d?.pages, d?.results, d?.data)) if (p?.ok !== false) out.push({ url: p.finalUrl ?? p.url, title: p.title ?? p.url, text: String(p.text ?? p.body ?? p.content ?? p.markdown ?? '').slice(0, 8000) });
  }
  return out;
}

export function emailsIn(text: string, domain?: string): string[] {
  const found = [...new Set((text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase().replace(/\.$/, '')))];
  return found.filter((e) => !/\.(png|jpe?g|gif|webp|svg)$/.test(e) && !/sentry|wixpress|example\.(com|org)/.test(e) && (!domain || e.endsWith('@' + domain) || true));
}

export type EmailVerdict = { email: string; ok: boolean; verdict: string };

/** Up to 100 addresses per call, $0.009: shape, live MX, disposable and role checks. */
export async function verifyEmails(job: Job, agent: Role, emails: string[], reason: string): Promise<EmailVerdict[]> {
  if (!emails.length) return [];
  const out: EmailVerdict[] = [];
  for (let i = 0; i < emails.length; i += 100) {
    const batch = emails.slice(i, i + 100);
    const data = await buy<any>(job, {
      agent, vendor: 'APEX email-verify', url: `https://${HOSTS.apex}/api/x402/email-verify-bulk?${qs({ emails: batch.join(',') })}`, method: 'GET',
      reason, expectUsd: 0.009, maxUsd: 0.015,
      dryData: () => ({ results: batch.map((e, k) => ({ email: e, verdict: k % 4 === 3 ? 'undeliverable' : 'deliverable' })) }),
    });
    const d = apex(data);
    for (const r of list(d?.results, d?.emails, d?.data)) {
      const v = String(r.verdict ?? r.status ?? r.result ?? (r.deliverable ? 'deliverable' : 'unknown')).toLowerCase();
      out.push({ email: String(r.email ?? r.address).toLowerCase(), ok: /deliverable|valid|ok|safe/.test(v) && !/un(deliverable)|invalid|disposable/.test(v), verdict: v });
    }
  }
  return out;
}

/** Text of a public PDF, page by page, $0.003. */
export async function pdfText(job: Job, agent: Role, url: string, reason: string): Promise<string> {
  const data = await buy<any>(job, {
    agent, vendor: 'APEX pdf-text', url: `https://${HOSTS.apex}/api/x402/pdf-text?${qs({ url })}`, method: 'GET',
    reason, expectUsd: 0.003, maxUsd: 0.006,
    dryData: () => ({ pages: [{ page: 1, text: 'INVOICE #1042\nAcme Supplies Ltd\nDate: 2026-09-20\nFlour 25kg x2  ₦48,000\nSugar 10kg x1  ₦14,500\nTotal ₦62,500' }] }),
  });
  const d = apex(data);
  const pages = list(d?.pages, d?.results);
  return pages.length ? pages.map((p: any) => `--- page ${p.page ?? ''}\n${p.text ?? ''}`).join('\n') : String(d?.text ?? '');
}

// ---------- Tomba (Orthogonal, GET)

export type FoundEmail = { email: string; name?: string; position?: string; type?: string; score?: number };

/** Emails published for a domain, $0.01. Used only when the site's own pages show none. */
export async function domainEmails(job: Job, agent: Role, domain: string, reason: string): Promise<FoundEmail[]> {
  const data = await buy<any>(job, {
    agent, vendor: 'Tomba domain-search', url: `https://${HOSTS.orthogonal}/tomba/v1/domain-search?${qs({ domain })}`, method: 'GET',
    reason, expectUsd: 0.01, maxUsd: 0.015,
    dryData: () => ({ data: { emails: [{ email: `info@${domain}`, type: 'generic', score: 80 }] } }),
  });
  const arr = data?.data?.emails ?? data?.emails ?? [];
  return arr.map((e: any) => ({ email: String(e.email).toLowerCase(), name: [e.first_name, e.last_name].filter(Boolean).join(' ') || undefined, position: e.position ?? undefined, type: e.type, score: e.score }));
}

// ---------- search & read

export type SearchHit = { title: string; link: string; snippet: string };

export async function webSearch(job: Job, agent: Role, q: string, reason: string): Promise<SearchHit[]> {
  const data = await buy<any>(job, {
    agent, vendor: 'Serper (Orthogonal)', url: `https://${HOSTS.orthogonal}/serper/search`,
    body: { q, num: 10 }, reason, expectUsd: 0.002, maxUsd: 0.005,
    dryData: () => ({ organic: [1, 2, 3].map((i) => ({ title: `Result ${i} for ${q}`, link: `https://example.com/${encodeURIComponent(q)}/${i}`, snippet: `Snippet ${i} about ${q}.` })) }),
  });
  return (data?.organic ?? []).map((o: any) => ({ title: o.title, link: o.link, snippet: o.snippet ?? '' }));
}

export async function neuralSearch(job: Job, agent: Role, query: string, reason: string, numResults = 6): Promise<SearchHit[]> {
  const data = await buy<any>(job, {
    agent, vendor: 'Exa search', url: `https://${HOSTS.exa}/search`,
    body: { query, numResults, type: 'auto', contents: { highlights: true } }, reason, expectUsd: 0.007, maxUsd: 0.012,
    dryData: () => ({ results: [1, 2].map((i) => ({ title: `Exa ${i}: ${query}`, url: `https://example.org/exa/${i}`, highlights: [`Key finding ${i} about ${query}.`] })) }),
  });
  return (data?.results ?? []).map((r: any) => ({ title: r.title ?? r.url, link: r.url, snippet: (r.highlights ?? []).join(' … ') }));
}

export type Page = { url: string; title: string; text: string };

export async function readPages(job: Job, agent: Role, urls: string[], reason: string): Promise<Page[]> {
  if (!urls.length) return [];
  const data = await buy<any>(job, {
    agent, vendor: 'Exa contents', url: `https://${HOSTS.exa}/contents`,
    body: { urls, text: { maxCharacters: 6000 } }, reason, expectUsd: 0.001 * urls.length, maxUsd: 0.002 * urls.length + 0.002,
    dryData: () => ({ results: urls.map((u) => ({ url: u, title: `Page ${u}`, text: `Body text of ${u}. It contains facts, prices and names relevant to the brief.` })) }),
  });
  return (data?.results ?? []).map((r: any) => ({ url: r.url, title: r.title ?? r.url, text: String(r.text ?? '').slice(0, 6000) }));
}

export type Place = {
  title: string; address?: string; phone?: string; website?: string; rating?: number; ratingCount?: number;
  category?: string; hours?: string; lat?: number; lng?: number; cid?: string;
};

export async function mapsSearch(job: Job, agent: Role, q: string, reason: string, page = 1): Promise<Place[]> {
  const data = await buy<any>(job, {
    agent, vendor: 'Serper Maps (Orthogonal)', url: `https://${HOSTS.orthogonal}/serper/maps`,
    body: { q, page }, reason, expectUsd: 0.006, maxUsd: 0.01,
    dryData: () => ({
      places: [1, 2, 3, 4, 5].map((i) => ({
        title: `${q} #${page}-${i}`, address: `${i} Admiralty Way, Lekki`, phoneNumber: i % 2 ? `0803 000 00${i}${page}` : undefined,
        website: i % 3 === 0 ? undefined : `https://${q.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '')}${page}${i}.ng`,
        rating: 3.8 + i / 10, ratingCount: 12 * i, type: 'Cafe', cid: `${q.length}-${page}${i}`,
      })),
    }),
  });
  return (data?.places ?? []).map((p: any) => ({
    title: p.title, address: p.address, phone: p.phoneNumber, website: p.website, rating: p.rating, ratingCount: p.ratingCount,
    category: p.type ?? p.category, hours: typeof p.openingHours === 'object' ? Object.entries(p.openingHours).map(([d, h]) => `${d}: ${h}`).join('; ') : p.openingHours,
    lat: p.latitude, lng: p.longitude, cid: p.cid ? String(p.cid) : undefined,
  }));
}

/**
 * Fallback when the Maps seller is down: find listings on the open web (Exa), read the best pages
 * (Exa contents) and extract businesses with an LLM that may only copy what the pages say.
 */
export async function webPlaces(job: Job, spec: { category: string; location: string; queries: string[] }, want: number): Promise<Place[]> {
  const hits: SearchHit[] = [];
  for (const q of [`${spec.category} in ${spec.location}`, ...spec.queries].slice(0, 2)) {
    try { hits.push(...(await neuralSearch(job, 'scout', `${q}: list of businesses with addresses and phone numbers`, `web listings: "${q}"`, 8))); }
    catch (e: any) { job.log('scout', 'skip', `web search "${q}" failed (${String(e?.message ?? e).slice(0, 50)})`); }
  }
  const urls = [...new Set(hits.map((h) => h.link))].slice(0, 5);
  if (!urls.length) return [];
  job.log('scout', 'read', `${urls.length} listing pages`);
  let pages: Page[];
  try { pages = await readPages(job, 'scout', urls, `read ${urls.length} listing pages`); }
  catch (e: any) {
    job.log('scout', 'skip', `reading pages failed (${String(e?.message ?? e).slice(0, 50)}); using the search snippets`);
    pages = hits.map((h) => ({ url: h.link, title: h.title, text: `${h.title}\n${h.snippet}` }));
  }
  job.log('researcher', 'extract', 'businesses named on those pages (no guessing)');
  const text = pages.map((p, i) => `[${i + 1}] ${p.url}\n${p.text.slice(0, 3500)}`).join('\n\n');
  const out = parseJson<{ places: { name: string; address?: string; phone?: string; website?: string; category?: string }[] }>(
    await llm(job, 'researcher', [
      { role: 'system', content: `Extract real businesses from web pages. Only include a business whose name appears in the text and that is located in ${spec.location}. Copy address, phone and website exactly as written; leave a field out if the page does not state it. Never invent or guess. Reply JSON only: {"places":[{"name","address","phone","website","category"}]} with at most ${want} places.` },
      { role: 'user', content: `Category: ${spec.category}\nLocation: ${spec.location}\n\n${text}` },
    ], 'extract businesses from the listing pages', { model: MODELS.fast, maxTokens: 2000, json: true,
      dry: () => JSON.stringify({ places: [1, 2, 3].map((i) => ({ name: `${spec.category} spot ${i}`, address: `${i} Main Road, ${spec.location}`, phone: i % 2 ? `0803 111 22${i}` : undefined, website: i === 2 ? undefined : `https://${spec.category.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '')}-${i}.ng` })) }) }),
    { places: [] },
  );
  return (out.places ?? []).filter((p) => p?.name).map((p) => ({ title: p.name, address: p.address, phone: p.phone, website: p.website, category: p.category ?? spec.category }));
}

// ---------- LLM (BlockRun, OpenAI-compatible)

export type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export type Msg = { role: 'system' | 'user' | 'assistant'; content: string | Part[] };

/** Models only BlockRun's Arc endpoint sells; it takes a direct USDC transfer, not a Gateway balance. */
const ARC_ONLY = /claude-opus-5|claude-sonnet-5|claude-fable/;

export async function llm(
  job: Job, agent: Role, messages: Msg[], reason: string,
  opts: { model?: string; fallback?: string; alt?: string | null; maxTokens?: number; maxUsd?: number; json?: boolean; dry?: () => string } = {},
): Promise<string> {
  const model = opts.model ?? MODELS.maker;
  const direct = ARC_ONLY.test(model);
  const maxTokens = opts.maxTokens ?? 1800;
  try {
    const data = await buy<any>(job, {
      agent, vendor: `BlockRun ${model.split('/')[1]}`, url: `https://${direct ? HOSTS.blockrunArc : HOSTS.blockrun}/api/v1/chat/completions`,
      body: { model, messages, max_tokens: maxTokens, ...(opts.json ? { response_format: { type: 'json_object' } } : {}) },
      reason, expectUsd: Math.max(0.01, (maxTokens * 12) / 1e6), maxUsd: opts.maxUsd ?? 0.08, direct,
      dryData: () => ({ choices: [{ message: { content: opts.dry ? opts.dry() : `(dry) ${reason}` } }] }),
    });
    return String(data?.choices?.[0]?.message?.content ?? '');
  } catch (e: any) {
    // The newest models need USDC in the agent's own wallet. When it's empty the job doesn't stall:
    // the same work goes to the fallback model through Gateway, and the step log says so.
    if (e instanceof NoWalletFunds && opts.fallback) {
      job.log(agent, 'fallback', `${model.split('/')[1]} is paid from the ${agent}'s own wallet, which is empty; using ${opts.fallback.split('/')[1]} through Gateway`);
      return llm(job, agent, messages, reason, { ...opts, model: opts.fallback, fallback: undefined });
    }
    // The model's provider is down (BlockRun says so): the step goes once to a model from another provider
    // instead of failing a paid job. It's a new call for a different model, never a second payment for the same one.
    const alt = opts.alt === undefined ? altModel(model) : opts.alt;
    if (alt && !(e instanceof SpendRefused) && PROVIDER_DOWN.test(String(e?.message ?? e))) {
      job.log(agent, 'fallback', `${model.split('/')[1]} is down at its provider; the same step goes to ${alt.split('/')[1]}`);
      return llm(job, agent, messages, reason, { ...opts, model: alt, fallback: undefined, alt: null });
    }
    throw e;
  }
}

const PROVIDER_DOWN = /provider api issue|provider (error|unavailable)|upstream|overloaded|model (is )?unavailable/i;
/** Another provider's model for the same step: Anthropic's go to OpenAI's and back. Opus has its own fallback. */
const altModel = (model: string) => (/opus|fable/.test(model) ? null : model.startsWith('anthropic/') ? MODELS.auditor : MODELS.maker);

export function parseJson<T>(s: string, fallback: T): T {
  const m = s.match(/\{[\s\S]*\}/);
  try {
    return m ? (JSON.parse(m[0]) as T) : fallback;
  } catch {
    return fallback;
  }
}
