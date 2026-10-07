// Research Brief: the reference pipeline every other service copies.
// Researcher plans → Scout searches (Serper + Exa) → Reader reads the best sources (Exa contents)
// → Researcher writes a cited brief → Auditor (different model family) checks every claim
// against the sources → Writer revises once if the Auditor says so.
import { Job } from '../job.ts';
import { MODELS } from '../config.ts';
import { HOSTS, llm, neuralSearch, parseJson, readPages, webSearch, type Page, type SearchHit } from '../tools.ts';
import { MAIL_BUDGET_USD, MAIL_HOST } from '../mail.ts';

export const researchBrief = {
  id: 'research-brief',
  name: 'Research Brief',
  priceUsd: 2,
  policy: { budgetUsd: 0.6 + MAIL_BUDGET_USD, allowHosts: [HOSTS.blockrun, HOSTS.orthogonal, HOSTS.exa, ...(MAIL_HOST ? [MAIL_HOST] : [])] },

  async run(brief: string, opts: { orderId?: string } = {}): Promise<Job> {
    const job = new Job(this.id, brief, this.policy, opts.orderId);
    try {
      const { markdown, qa } = await researchInto(job, brief);
      job.qa = { verdict: qa.verdict, notes: qa.issues.join(' | '), model: MODELS.auditor };
      job.deliverable = markdown;
      job.status = 'delivered';
    } catch (e: any) {
      job.status = 'failed';
      job.error = String(e?.message ?? e);
      console.error('  ✗', job.error);
    }
    job.save();
    return job;
  },
};

/** The research itself, run inside any job (Market Research orders, and the market section of the Market & Google
 *  Report): plan → search → read → cited draft → independent audit → one revision. Returns the brief in Markdown. */
export async function researchInto(job: Job, brief: string): Promise<{ markdown: string; qa: { verdict: 'pass' | 'revise'; issues: string[] } }> {
  // 1. Plan
  job.log('researcher', 'plan', 'turning the brief into search queries and an outline');
  const plan = parseJson<{ queries: string[]; outline: string[] }>(
    await llm(job, 'researcher', [
      { role: 'system', content: 'You plan research for a small-business client. Reply with JSON only: {"queries": [4 web search queries], "outline": [5-7 section headings]}. Queries must be specific and include the location or market if the brief has one.' },
      { role: 'user', content: brief },
    ], 'plan search queries and outline', { model: MODELS.fast, maxTokens: 500, json: true,
      dry: () => JSON.stringify({ queries: ['q1 ' + brief, 'q2 ' + brief, 'q3 ' + brief, 'q4 ' + brief], outline: ['Market overview', 'Competitors', 'Pricing', 'Opportunities', 'Recommendations'] }) }),
    { queries: [brief], outline: ['Findings', 'Recommendations'] },
  );
  const queries = plan.queries.slice(0, 4);

  // 2. Search
  job.log('scout', 'search', `${queries.length} Google queries + 1 Exa neural search`);
  const hits: SearchHit[] = [];
  const tryHits = async (label: string, f: () => Promise<typeof hits>) => { try { hits.push(...(await f())); } catch (e: any) { job.log('scout', 'skip', `${label} failed (${String(e?.message ?? e).slice(0, 50)}); moving on`); } };
  for (const q of queries) await tryHits(`"${q}"`, () => webSearch(job, 'scout', q, `Google search: "${q}"`));
  await tryHits('neural search', () => neuralSearch(job, 'scout', brief, 'neural search on the whole brief', 6));
  if (!hits.length) throw new Error('no search came back; nothing to research');

  // 3. Choose and read sources (dedupe by host, prefer diverse domains)
  const seen = new Set<string>();
  const picks: string[] = [];
  for (const h of hits) {
    let host = '';
    try { host = new URL(h.link).host; } catch { continue; }
    if (seen.has(host) || /youtube|facebook|instagram|tiktok|x\.com|twitter|linkedin|pinterest/.test(host)) continue;
    seen.add(host);
    picks.push(h.link);
    if (picks.length >= 6) break;
  }
  job.log('reader', 'read', `${picks.length} sources`);
  const pages: Page[] = await readPages(job, 'reader', picks, `read ${picks.length} sources in full`);

  // 4. Write
  const sources = pages.map((p, i) => `[${i + 1}] ${p.title} — ${p.url}\n${p.text.slice(0, 3500)}`).join('\n\n---\n\n');
  const snippets = hits.slice(0, 20).map((h) => `- ${h.title}: ${h.snippet} (${h.link})`).join('\n');
  job.log('researcher', 'write', 'drafting the cited brief');
  let draft = await llm(job, 'researcher', [
    { role: 'system', content: `You are a senior analyst writing a research brief for a small business. Use ONLY the sources and snippets provided. Cite every factual claim with [n] matching the numbered sources. If something is not in the sources, say it is unknown instead of guessing. Structure: a 3-bullet summary, then these sections: ${plan.outline.join(', ')}, then "Recommendations" (concrete next steps), then "Sources" listing [n] title — url. Markdown. 600–900 words.` },
    { role: 'user', content: `Brief: ${brief}\n\nNumbered sources:\n${sources}\n\nOther search snippets (lower confidence, cite as [web] if used):\n${snippets}` },
  ], 'write the cited brief', { maxTokens: 2200, dry: () => `# Research brief\n\n- Summary point [1]\n\n## Recommendations\n- Do X [2]\n\n## Sources\n${pages.map((p, i) => `[${i + 1}] ${p.title} — ${p.url}`).join('\n')}` });

  // 5. Audit (different model family; never the maker grading itself)
  job.log('auditor', 'audit', `checking claims against sources with ${MODELS.auditor}`);
  const audit = parseJson<{ verdict: 'pass' | 'revise'; issues: string[] }>(
    await llm(job, 'auditor', [
      { role: 'system', content: 'You are an independent auditor. Check the brief against the numbered sources. Flag: claims with no citation, citations that do not support the claim, invented numbers, missing Sources section, and advice that ignores the brief. Reply JSON only: {"verdict": "pass" | "revise", "issues": [short strings]}. Use "revise" if any claim is unsupported.' },
      { role: 'user', content: `Brief: ${brief}\n\nSources:\n${sources.slice(0, 16000)}\n\nDraft:\n${draft}` },
    ], 'independent QA of every claim', { model: MODELS.auditor, maxTokens: 700, json: true, dry: () => JSON.stringify({ verdict: 'pass', issues: [] }) }),
    { verdict: 'pass', issues: [] },
  );

  // 6. Revise once if needed
  if (audit.verdict === 'revise' && audit.issues.length) {
    job.log('writer', 'revise', `${audit.issues.length} issues from the Auditor`);
    draft = await llm(job, 'writer', [
      { role: 'system', content: 'Revise the brief to fix every auditor issue. Remove or soften any claim the sources do not support. Keep citations [n] and the Sources section. Output the full revised brief in Markdown only.' },
      { role: 'user', content: `Auditor issues:\n- ${audit.issues.join('\n- ')}\n\nSources:\n${sources.slice(0, 16000)}\n\nDraft:\n${draft}` },
    ], 'fix the auditor\'s issues', { maxTokens: 2200, dry: () => draft });
  }
  return { markdown: draft.trim(), qa: audit };
}
