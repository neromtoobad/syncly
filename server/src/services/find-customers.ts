// Find Customers: for a freelancer or a business that wants more clients. Tell us what you sell and where; the team
// works out who buys it, finds them, and hands you a contact list with a first message for each.
// Researcher parses the brief → Analyst names 2-3 customer types, each with a sign they need it now (no website,
// few reviews…) and the searches that find them (skipped when the customer already said who) → Scout pulls them from
// Google Maps (open web if Maps is down) → rules rank who fits the sign best and drop duplicates → Reader looks for a
// published email on the best fits' own sites; Investigator checks each one can receive mail → Scout also searches for
// people publicly asking for this right now → Writer drafts one first message per lead from its real data, where to
// find more, and a 7-day plan → deterministic QA. Syncly never contacts anyone for you.
import { Job } from '../job.ts';
import { MODELS } from '../config.ts';
import { HOSTS, emailsIn, llm, mapsSearch, parseJson, verifyEmails, webPlaces, webRead, webSearch, type Place } from '../tools.ts';
import { MAIL_BUDGET_USD, MAIL_HOST } from '../mail.ts';
import type { BusinessDetails } from '../details.ts';

type Signal = 'no_website' | 'few_reviews' | 'has_website' | 'any';
type Segment = { name: string; why: string; signal: Signal; signalText: string; queries: string[] };
type Spec = { offer: string; seller: string; location: string; target: string | null; want: number; intent: string[] };
type Lead = Place & { segment: string; fit: boolean; phoneE164?: string; domain?: string; email?: string; emailOk?: boolean; message?: string };

const csvCell = (v: unknown) => { const s = v === undefined || v === null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const hostOf = (u?: string) => { try { return u ? new URL(u.startsWith('http') ? u : `https://${u}`).host.replace(/^www\./, '') : ''; } catch { return ''; } };
const SOCIAL = /facebook|instagram|linktr|wa\.me|whatsapp|google|booking\.com|tripadvisor|tiktok|x\.com|twitter/;
function normPhone(p?: string): string | undefined {
  if (!p) return undefined;
  const first = p.split(/[\/,;|]|\bor\b/i).find((x) => (x.match(/\d/g) ?? []).length >= 7) ?? p;
  const d = first.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d;
  if (d.startsWith('234')) return '+' + d;
  if (d.startsWith('0') && d.length === 11) return '+234' + d.slice(1);
  return d || undefined;
}
const fits = (p: Place, s: Signal) => s === 'no_website' ? !p.website || SOCIAL.test(hostOf(p.website)) : s === 'few_reviews' ? (p.ratingCount ?? 0) < 25 : s === 'has_website' ? !!p.website && !SOCIAL.test(hostOf(p.website)) : true;

export const findCustomers = {
  id: 'find-customers',
  name: 'Find Customers',
  priceUsd: 2,
  policy: { budgetUsd: 0.9 + MAIL_BUDGET_USD, allowHosts: [HOSTS.blockrun, HOSTS.orthogonal, HOSTS.apex, HOSTS.exa, ...(MAIL_HOST ? [MAIL_HOST] : [])] },

  async run(brief: string, opts: { orderId?: string; details?: BusinessDetails } = {}): Promise<Job> {
    const job = new Job(this.id, brief, this.policy, opts.orderId);
    try {
      // 1. What they sell, where, and whether they already know who to target
      job.log('researcher', 'parse', 'what you sell, where, and who you want to reach');
      const spec = parseJson<Spec>(await llm(job, 'researcher', [
        { role: 'system', content: 'Parse a request from a freelancer or business that wants new customers. Reply JSON only: {"offer": what they sell (one sentence), "seller": who they are (e.g. "a freelance graphic designer", "a bakery"), "location": where they work or deliver (area, city, country; "Nigeria" if only the country is clear), "target": the type of customer they named, or null if they did not say, "want": number of leads (default 30, max 40), "intent": [2 web searches that would find people publicly asking for this offer right now in that place, e.g. "looking for a photographer in Abuja", "need a caterer Lekki recommendation"]}' },
        { role: 'user', content: brief },
      ], 'parse the request', { model: MODELS.fast, maxTokens: 400, json: true,
        dry: () => JSON.stringify({ offer: 'logo and brand design', seller: 'a freelance graphic designer', location: 'Abuja, Nigeria', target: null, want: 25, intent: ['looking for a graphic designer in Abuja', 'need a logo designer Abuja recommendation'] }) }),
        { offer: brief, seller: '', location: '', target: null, want: 30, intent: [] });
      spec.want = Math.min(40, Math.max(10, spec.want || 30));

      // 2. Who buys it: named by the customer, or worked out by the Analyst with a sign they need it now
      let segments: Segment[];
      if (spec.target) {
        job.log('analyst', 'target', `you named who: ${spec.target}`);
        segments = parseJson<{ segments: Segment[] }>(await llm(job, 'analyst', [
          { role: 'system', content: `Someone selling "${spec.offer}" wants customers of this type: "${spec.target}" in ${spec.location}. Reply JSON only: {"segments": [{"name": short label, "why": why they would buy (one sentence), "signal": "no_website"|"few_reviews"|"has_website"|"any" (the Google Maps sign that they need this offer most, "any" if none applies), "signalText": the sign in plain words, "queries": [2 Google Maps searches that find them in ${spec.location}]}]} with exactly one segment.` },
          { role: 'user', content: brief },
        ], 'turn the target into searches', { model: MODELS.fast, maxTokens: 400, json: true,
          dry: () => JSON.stringify({ segments: [{ name: spec.target, why: 'they need this', signal: 'any', signalText: 'any', queries: [`${spec.target} ${spec.location}`] }] }) }), { segments: [] }).segments;
      } else {
        job.log('analyst', 'who buys', `working out who buys ${spec.offer} in ${spec.location}`);
        segments = parseJson<{ segments: Segment[] }>(await llm(job, 'analyst', [
          { role: 'system', content: `You find customers for small businesses and freelancers in Nigeria and beyond. For someone (${spec.seller || 'a seller'}) selling "${spec.offer}" in ${spec.location}, name the 3 types of LOCAL BUSINESSES most likely to pay for it soon, which can be found on Google Maps. For each, the Maps sign that they need it now: "no_website" (e.g. web or branding work), "few_reviews" (new or small, e.g. marketing, photos), "has_website" (established, has budget), or "any". Reply JSON only: {"segments": [{"name": short label, "why": one sentence, concrete, "signal": "no_website"|"few_reviews"|"has_website"|"any", "signalText": the sign in plain words, "queries": [2 Google Maps searches that find them in ${spec.location}]}]}` },
          { role: 'user', content: brief },
        ], 'work out who buys it', { model: MODELS.maker, maxTokens: 900, json: true,
          dry: () => JSON.stringify({ segments: [
            { name: 'New restaurants and cafés', why: 'they open with a sign and an Instagram page but no brand system', signal: 'few_reviews', signalText: 'fewer than 25 reviews, so likely new', queries: ['restaurant Wuse Abuja', 'cafe Abuja'] },
            { name: 'Salons and spas', why: 'they compete on looks and need a logo, price list and flyers', signal: 'no_website', signalText: 'no website of their own', queries: ['hair salon Abuja', 'spa Abuja'] },
            { name: 'Private schools', why: 'they rebrand for each new session and print a lot', signal: 'has_website', signalText: 'has a website, so a budget', queries: ['private school Abuja'] },
          ] }) }), { segments: [] }).segments;
      }
      segments = (segments ?? []).filter((s) => s?.name && s.queries?.length).slice(0, 3).map((s) => ({ ...s, signal: (['no_website', 'few_reviews', 'has_website', 'any'] as Signal[]).includes(s.signal) ? s.signal : 'any', queries: s.queries.slice(0, 2) }));
      if (!segments.length) segments = [{ name: spec.target ?? spec.offer, why: '', signal: 'any', signalText: 'any', queries: [`${spec.target ?? spec.offer} ${spec.location}`] }];
      job.log('analyst', 'segments', segments.map((s) => `${s.name} (${s.signalText})`).join(' · '));

      // 3. Find them: Google Maps, two queries per type, the open web if Maps is down
      const byKey = new Map<string, Lead>();
      let mapsDown = false, calls = 0;
      for (const s of segments) {
        for (const q of s.queries) {
          if (mapsDown || calls >= 6) break;
          job.log('scout', 'maps', `"${q}"`);
          try {
            calls++;
            for (const p of await mapsSearch(job, 'scout', q, `find ${s.name}`)) {
              const key = `${p.title}|${p.address ?? ''}`.toLowerCase();
              if (!byKey.has(key)) byKey.set(key, { ...p, segment: s.name, fit: fits(p, s.signal) });
            }
          } catch (e: any) {
            if (/verification|temporarily unavailable/i.test(String(e?.message ?? e))) { mapsDown = true; job.log('scout', 'switch', 'the Maps seller cannot take payments right now; searching the open web instead'); }
            else job.log('scout', 'skip', `"${q}" failed; moving on`);
          }
        }
        if (mapsDown) for (const p of await webPlaces(job, { category: s.name, location: spec.location, queries: s.queries }, 15)) {
          const key = `${p.title}|${p.address ?? ''}`.toLowerCase();
          if (!byKey.has(key)) byKey.set(key, { ...p, segment: s.name, fit: fits(p, s.signal) });
        }
      }
      // rank: shows the sign first, then reachable (a phone), then the better known
      const all = [...byKey.values()].map((l) => ({ ...l, phoneE164: normPhone(l.phone), domain: l.website && !SOCIAL.test(hostOf(l.website)) ? hostOf(l.website) : undefined }));
      const leads = all.sort((a, b) => Number(b.fit) - Number(a.fit) || Number(!!b.phoneE164) - Number(!!a.phoneE164) || (b.ratingCount ?? 0) - (a.ratingCount ?? 0)).slice(0, spec.want);
      job.log('scout', 'shortlist', `${leads.length} of ${all.length} businesses kept, ${leads.filter((l) => l.fit).length} showing the sign`);

      // 4. Emails, cheapest first: read the best fits' own sites, then check every address can receive mail
      const withSite = leads.filter((l) => l.domain).slice(0, 12);
      if (withSite.length) {
        job.log('reader', 'read sites', `${withSite.length} sites for a published email`);
        const pages = await webRead(job, 'reader', withSite.flatMap((l) => [`https://${l.domain}`, `https://${l.domain}/contact`]), 'look for a published contact email');
        for (const l of withSite) { const text = pages.filter((p) => hostOf(p.url) === l.domain).map((p) => p.text).join('\n'); const e = emailsIn(text); l.email = e.find((x) => x.endsWith('@' + l.domain)) ?? e[0]; }
        const toCheck = leads.filter((l) => l.email);
        if (toCheck.length) {
          job.log('investigator', 'verify', `${toCheck.length} emails`);
          const v = new Map((await verifyEmails(job, 'investigator', toCheck.map((l) => l.email!), 'check each address can receive mail')).map((x) => [x.email, x.ok]));
          for (const l of toCheck) { l.emailOk = !!v.get(l.email!); if (!l.emailOk) l.email = undefined; }
        }
      }

      // 5. People asking for it right now, in public posts
      let asking: { title: string; link: string; snippet: string }[] = [];
      for (const q of spec.intent.slice(0, 2)) {
        try { job.log('scout', 'listen', `"${q}"`); asking.push(...(await webSearch(job, 'scout', q, 'people publicly asking for this offer'))); } catch { /* one search failing is fine */ }
      }
      asking = asking.filter((h, i, a) => a.findIndex((x) => x.link === h.link) === i).slice(0, 16);

      // 6. Messages, where to find more, and the plan, in one call from the real data only
      job.log('writer', 'messages', `${leads.length} first messages, where to find more, a 7-day plan`);
      const out = parseJson<{ messages: { i: number; message: string }[]; asking: { i: number; who: string }[]; places: string[]; plan: string[]; pitch: string }>(await llm(job, 'writer', [
        { role: 'system', content: `You help ${spec.seller || 'a seller'} who sells "${spec.offer}" in ${spec.location} win customers. Reply JSON only:
{"messages": [{"i": lead index, "message": a first WhatsApp or DM message to that business, max 45 words, warm and specific: name the business and one real thing from its data (its area, its rating, that it has no website, that it's new), then one line on what you offer them and a simple question. No invented facts, no flattery clichés, no prices unless given.}],
"asking": [{"i": search result index, "who": one line on who is asking and for what}] only for results where a real person or business is clearly asking for this kind of offer (skip articles, directories and adverts),
"places": [4-6 specific places to find more of these customers: named online communities, platforms, markets, associations or events in ${spec.location}; only ones you are confident exist],
"plan": [7 short lines, Day 1 to Day 7, a realistic outreach plan using this list],
"pitch": a 3-sentence pitch they can paste anywhere}` },
        { role: 'user', content: JSON.stringify({ leads: leads.map((l, i) => ({ i, name: l.title, type: l.segment, category: l.category, area: l.address, rating: l.rating, reviews: l.ratingCount, has_website: !!l.domain })), search_results: asking.map((h, i) => ({ i, title: h.title, link: h.link, snippet: h.snippet })) }) },
      ], 'write the messages and the plan', { maxTokens: 4000, json: true,
        dry: () => JSON.stringify({ messages: leads.map((l, i) => ({ i, message: `Hi ${l.title}, saw you on ${l.address ?? 'Google Maps'}. I help businesses like yours with ${spec.offer}. Can I send a few ideas?` })), asking: asking.slice(0, 2).map((_, i) => ({ i, who: 'Someone asking for a recommendation' })), places: ['Abuja Business Network on Facebook', 'Jiji services section'], plan: ['Day 1: message the 10 best fits'], pitch: `I help ${segments[0].name} with ${spec.offer}.` }) }),
        { messages: [], asking: [], places: [], plan: [], pitch: '' });
      for (const m of out.messages ?? []) if (leads[m.i]) leads[m.i].message = String(m.message ?? '').slice(0, 400);
      const askingNow = (out.asking ?? []).filter((a) => asking[a.i]).map((a) => ({ ...asking[a.i], who: String(a.who ?? '') }));

      // 7. Deterministic QA
      const reachable = leads.filter((l) => l.phoneE164 || l.email).length;
      const noMsg = leads.filter((l) => !l.message).length;
      const unnamed = leads.filter((l) => l.message && !l.message.toLowerCase().includes(l.title.split(/\s+/)[0].toLowerCase())).length;
      const issues = [
        leads.length < spec.want ? `${leads.length} of ${spec.want} leads found` : '',
        reachable < leads.length ? `${leads.length - reachable} leads have no phone or email (Maps shows none)` : '',
        noMsg ? `${noMsg} leads without a message` : '',
        unnamed ? `${unnamed} messages don't name the business` : '',
      ].filter(Boolean);
      const hardFail = leads.length === 0 || reachable === 0 || noMsg > Math.ceil(leads.length * 0.2);
      job.log('auditor', 'check', hardFail ? issues.join('; ') : `pass${issues.length ? ` (notes: ${issues.join('; ')})` : ''}`);
      job.qa = { verdict: hardFail ? 'revise' : 'pass', notes: issues.join(' | '), model: 'deterministic rules' };

      const header = ['business', 'customer type', 'shows the sign', 'phone', 'whatsapp', 'email', 'website', 'address', 'rating', 'reviews', 'first message'];
      const csv = [header.join(','), ...leads.map((l) => [l.title, l.segment, l.fit ? 'yes' : 'no', l.phoneE164, l.phoneE164?.startsWith('+234') ? `https://wa.me/${l.phoneE164.slice(1)}` : '', l.email, l.domain ? `https://${l.domain}` : '', l.address, l.rating, l.ratingCount, l.message].map(csvCell).join(','))].join('\n');
      job.files.push({ name: 'customers.csv', content: csv + '\n' });
      const top = leads.filter((l) => l.message).slice(0, 8);
      job.deliverable = [
        `# ${leads.length} potential customers for ${spec.offer}, ${spec.location}`,
        `## Who buys it`,
        ...segments.map((s) => `- **${s.name}**${s.why ? `: ${s.why.trim().replace(/[.!]?$/, '.')}` : ''}${s.signal !== 'any' ? ` Best sign they need it now: ${s.signalText}.` : ''} (${leads.filter((l) => l.segment === s.name).length} found)`),
        `## Your list`,
        `${reachable} of ${leads.length} have a phone${leads.some((l) => l.email) ? ` or an email that passed a deliverability check (${leads.filter((l) => l.email).length} emails)` : ''}. ${leads.filter((l) => l.fit).length} show the sign they need you now and are at the top. Every row has a first message written from its real Google Maps data; Nigerian numbers have a WhatsApp link. Read before you send: Syncly never contacts anyone for you.`,
        `| Business | Type | Phone | First message |\n|---|---|---|---|\n` + top.map((l) => `| ${l.title} | ${l.segment} | ${l.phoneE164 ?? l.email ?? ''} | ${(l.message ?? '').replace(/\|/g, '/')} |`).join('\n'),
        `The full list is in \`customers.csv\`.`,
        ...(askingNow.length ? [`## People asking for this right now`, ...askingNow.slice(0, 6).map((a) => `- ${a.who} [${a.title}](${a.link})`)] : []),
        ...(out.places?.length ? [`## Where to find more`, ...out.places.slice(0, 6).map((p) => `- ${p}`)] : []),
        ...(out.plan?.length ? [`## Your next 7 days`, ...out.plan.slice(0, 7).map((p) => `- ${p}`)] : []),
        ...(out.pitch ? [`## A pitch to paste anywhere`, `> ${out.pitch}`] : []),
        ...(issues.length ? [`> Notes: ${issues.join('; ')}`] : []),
      ].join('\n\n');
      job.status = hardFail ? 'failed' : 'delivered';
      if (hardFail) job.error = `QA failed: ${issues.join('; ')}`;
    } catch (e: any) {
      job.status = 'failed';
      job.error = String(e?.message ?? e);
      console.error('  ✗', job.error);
    }
    job.save();
    return job;
  },
};
