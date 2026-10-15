// Ad Launch: paid ads that bring customers, not likes. Everything a small business needs to run ads on
// Instagram, Facebook and TikTok, and to stop paying for boosts that don't sell.
// Researcher reads the order → Scout pulls the ads in the niche that have run for 30+ days (an ad that
// keeps running is one that pays) → Analyst reads screenshots of the ads they already ran (the numbers are
// read off the screen; the diagnosis comes from fixed rules in code) and names 3 angles, each backed by real
// long-running ads → Writer drafts the copy for each angle → Designer stages their product photo once per
// angle, and our server typesets feed (4:5) and Story (9:16) creatives, a different layout per angle → Producer
// cuts a 10 s video per angle with our promo engine (their real product photo, licensed music, cut on the beat;
// no paid AI video) → the plan (who to show it to, the budget split, when to stop or scale, setup steps)
// is computed in code from their budget → QA: code checks every number in the copy against the order; an
// auditor on another model family checks for invented claims; a vision model looks at every creative.
import { Job } from '../job.ts';
import { headsUp, withBrandKit } from '../brandkit.ts';
import { MODELS } from '../config.ts';
import { HOSTS, llm, parseJson } from '../tools.ts';
import { AISA, aisa } from '../sellers.ts';
import { editImage, ffmpeg, image } from '../media.ts';
import { htmlToPng } from '../browser.ts';
import { MAIL_BUDGET_USD, MAIL_HOST } from '../mail.ts';
import type { BusinessDetails } from '../details.ts';
import { readUpload } from '../uploads.ts';
import { prettyPhone, waLink } from '../site/facts.ts';
import { zip } from '../zip.ts';
import { accentFor, productPhoto } from './video-ad.ts';
import { promoVideo, squareOf, type PromoOut } from '../promo-video.ts';
import { MUSIC_LICENSE } from '../music.ts';
import type { Storyboard } from '../promo.ts';

type Goal = 'messages' | 'sales' | 'calls' | 'visits' | 'followers';
type Money = { amount: number; currency: string; daily: number; text: string };
type Spec = {
  business: string; product: string; offer: string; price?: string; cta: string; niche: string; location: string; area: string; city: string;
  audience: string; mood: string; scene: string; instagram?: string; website?: string; whatsapp?: string; phone?: string; address?: string;
  goal: Goal; budget?: Money; platforms: ('meta' | 'tiktok')[];
};
type Ad = { n: number; brand: string; platform: string; format: string; days?: number; text: string; cta?: string; url: string };
type Angle = { name: string; idea: string; hook: string; scene: string; cites: number[] };
type Copy = { overlay: string; primary: string[]; headline: string[]; tiktok: string };
type Read = { readable: boolean; platform?: string; objective?: string; resultType?: string; spend?: number; currency?: string; reach?: number; impressions?: number; results?: number; costPerResult?: number; linkClicks?: number; ctr?: number; frequency?: number; days?: number };
type Finding = { title: string; detail: string; fix: string };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const csvCell = (v: unknown) => { const s = v === undefined || v === null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const errMsg = (e: any) => String(e?.message ?? e);
const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v.trim() && isFinite(Number(v.replace(/,/g, ''))) ? Number(v.replace(/,/g, '')) : undefined);
const SYMBOL: Record<string, string> = { NGN: '₦', USD: '$', GBP: '£', EUR: '€', GHS: 'GH₵', KES: 'KSh ' };
const money = (n: number, cur = 'NGN') => `${SYMBOL[cur] ?? `${cur} `}${Math.round(n).toLocaleString('en-NG')}`;
const digits = (s: string) => (s.match(/\d[\d,.]*/g) ?? []).map((x) => x.replace(/[,.]+$/, '').replace(/,/g, '')).filter((x) => x.length);

/** "₦5,000 a day", "N5k daily", "100k a month", "$10/day" → a daily amount. A total is spread over the 7-day test. */
export function parseBudget(text: string | undefined, nigeria = true): Money | undefined {
  if (!text) return undefined;
  const t = text.replace(/,/g, '').toLowerCase();
  const m = t.match(/(\d+(?:\.\d+)?)\s*(k|m)?/);
  if (!m) return undefined;
  const amount = Number(m[1]) * (m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1);
  const currency = /\$|usd|dollar/.test(t) ? 'USD' : /£|gbp/.test(t) ? 'GBP' : /€|eur/.test(t) ? 'EUR' : /₦|ngn|naira|\bn\s?\d/.test(t) || nigeria ? 'NGN' : 'NGN';
  const daily = /week|wk/.test(t) ? amount / 7 : /month|mo\b/.test(t) ? amount / 30 : /total|in all|altogether|for the (whole|test)/.test(t) ? amount / 7 : amount;
  return amount > 0 ? { amount, currency, daily, text: text.trim() } : undefined;
}

/** What each goal is called in Meta Ads Manager, and the button that goes with it. */
const META: Record<Goal, { objective: string; where: string; button: string; boost?: string; result: string }> = {
  messages: { objective: 'Engagement', where: 'Messaging apps, then WhatsApp', button: 'Send WhatsApp message', boost: 'More messages, then WhatsApp', result: 'messages' },
  sales: { objective: 'Sales', where: 'Website', button: 'Shop now', boost: 'More website visits', result: 'website visits that buy' },
  calls: { objective: 'Engagement', where: 'Calls', button: 'Call now', result: 'calls' },
  visits: { objective: 'Awareness', where: 'Reach, with the map pin on your shop', button: 'Get directions', result: 'people reached near your shop' },
  followers: { objective: 'Traffic', where: 'Instagram profile', button: 'Visit Instagram profile', boost: 'More profile visits', result: 'profile visits' },
};

// ---------- the creatives: their staged photo, typeset on our server (safe zones kept clear of the app's buttons)

function creative(o: { photo: Buffer; hook: string; price?: string; cta: string; business: string; accent: string; onAccent: string; logo?: Buffer; w: number; h: number; look?: number }): string {
  const story = o.h > o.w * 1.5;
  const look = (o.look ?? 0) % 3; // 0: photo + title at the foot · 1: a colour band with the title on top · 2: the photo framed on their colour
  const size = o.hook.length <= 16 ? 104 : o.hook.length <= 28 ? 88 : 72;
  const top = story ? 250 : 64;
  const bottom = story ? 420 : 72;
  const logo = o.logo ? `<img class="logo" src="data:image/jpeg;base64,${o.logo.toString('base64')}" alt="">` : `<div class="name">${esc(o.business)}</div>`;
  const img = `data:image/png;base64,${o.photo.toString('base64')}`;
  const row = `<div class="row">${o.price ? `<div class="price">${esc(o.price)}</div>` : ''}<div class="cta">${esc(o.cta)}</div></div>`;
  const band = Math.round(o.h * (story ? 0.36 : 0.34));
  const body = look === 1
    ? `<img class="bg" style="top:${band - 40}px;height:${o.h - band + 40}px" src="${img}" alt=""><div class="scrim" style="background:linear-gradient(180deg,rgba(0,0,0,0) 55%,rgba(0,0,0,.6) 100%)"></div>
<div class="band" style="height:${band}px"><div class="head" style="position:static">${logo}</div><div class="hook" style="color:${o.onAccent};text-shadow:none;margin-top:28px">${esc(o.hook)}</div></div>
<div class="foot">${row}</div>`
    : look === 2
      ? `<div class="paper"></div><div class="head">${logo}</div>
<div class="frame" style="top:${top + (story ? 150 : 130)}px;bottom:${bottom + (story ? 330 : 290)}px"><img src="${img}" alt="">${o.price ? `<div class="price tilt">${esc(o.price)}</div>` : ''}</div>
<div class="foot"><div class="hook" style="color:${o.onAccent};text-shadow:none;font-size:${Math.round(size * 0.82)}px">${esc(o.hook)}</div><div class="row"><div class="cta">${esc(o.cta)}</div></div></div>`
      : `<img class="bg" src="${img}" alt=""><div class="scrim"></div><div class="head">${logo}</div><div class="foot"><div class="hook">${esc(o.hook)}</div>${row}</div>`;
  return `<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Geist:wght@500;600&display=block" rel="stylesheet"><style>
*{box-sizing:border-box}html,body{margin:0;width:${o.w}px;height:${o.h}px;overflow:hidden;background:${look ? o.accent : '#111'}}
.bg{position:absolute;left:0;right:0;top:0;width:100%;height:100%;object-fit:cover;object-position:50% 50%}
.scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.5) 0%,rgba(0,0,0,0) ${story ? 30 : 28}%,rgba(0,0,0,0) ${story ? 52 : 48}%,rgba(0,0,0,.72) 100%)}
.band{position:absolute;left:0;right:0;top:0;background:${o.accent};padding:${top}px 64px 0;border-radius:0 0 48px 48px;box-shadow:0 18px 50px rgba(0,0,0,.25);z-index:2}
.paper{position:absolute;inset:0;background:radial-gradient(circle at 85% 8%,rgba(255,255,255,.22),transparent 45%),radial-gradient(circle at 0% 100%,rgba(0,0,0,.25),transparent 50%)}
.frame{position:absolute;left:64px;right:64px;border-radius:40px;overflow:visible}
.frame img{width:100%;height:100%;object-fit:cover;border-radius:40px;box-shadow:0 24px 60px rgba(0,0,0,.35);display:block}
.frame .tilt{position:absolute;right:-12px;bottom:-26px;transform:rotate(-4deg)}
.head{position:absolute;left:64px;right:64px;top:${top}px;display:flex;align-items:center;gap:20px}
.logo{width:${story ? 120 : 104}px;height:${story ? 120 : 104}px;border-radius:50%;object-fit:cover;background:#fff;box-shadow:0 6px 24px rgba(0,0,0,.25)}
.name{font:600 34px/1 Geist;color:#fff;letter-spacing:.02em;background:rgba(0,0,0,.28);padding:16px 22px;border-radius:999px}
.foot{position:absolute;left:64px;right:64px;bottom:${bottom}px;z-index:3}
.hook{font:800 ${size}px/0.98 'Bricolage Grotesque';color:#fff;letter-spacing:-0.03em;text-shadow:0 4px 32px rgba(0,0,0,.35);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:18px;margin-top:34px}
.price{background:${look === 2 ? o.onAccent : o.accent};color:${look === 2 ? o.accent : o.onAccent};font:700 46px/1 'Bricolage Grotesque';padding:22px 30px;border-radius:18px;box-shadow:0 8px 24px rgba(0,0,0,.25)}
.cta{background:#fff;color:#111;font:600 36px/1.1 Geist;padding:22px 30px;border-radius:999px;max-width:100%}
</style></head><body>${body}</body></html>`;
}
const toJpeg = (png: Buffer) => ffmpeg({ 'x.png': png }, (f, out) => ['-i', f['x.png'], '-q:v', '2', out], 'jpg');

// ---------- what their own ads show: numbers read off the screenshot, verdicts from fixed rules

function diagnose(r: Read, goal: Goal): Finding[] {
  const out: Finding[] = [];
  const cur = r.currency ?? 'NGN';
  const paidFor = `${r.objective ?? ''} ${r.resultType ?? ''}`;
  if (goal !== 'followers' && goal !== 'visits' && /engagement|post engagement|reach|impression|profile visit|like|video view|thruplay|follow/i.test(paidFor) && !/message|conversation|call|purchase|lead|website|link click|landing/i.test(paidFor)) {
    out.push({ title: 'You paid for attention, not customers', detail: `Your screenshot shows results counted as "${(r.resultType ?? r.objective)!.trim()}".`, fix: `Choose the ${META[goal].objective} objective with ${META[goal].where} so Meta looks for people who ${goal === 'messages' ? 'send messages' : goal === 'calls' ? 'call' : 'buy'}, not people who like posts.` });
  }
  const ctr = r.ctr ?? (r.linkClicks !== undefined && r.impressions ? (r.linkClicks / r.impressions) * 100 : undefined);
  if (ctr !== undefined && ctr >= 0 && ctr < 1) out.push({ title: 'Most people scroll past', detail: `About ${ctr.toFixed(2)}% of people who saw it clicked${r.ctr === undefined ? ` (${r.linkClicks} clicks from ${r.impressions?.toLocaleString('en-NG')} views)` : ''}.`, fix: 'A common rule of thumb is that under 1% means the first second isn\'t stopping people. The new creatives lead with the product and the price.' });
  if (r.frequency !== undefined && r.frequency > 3) out.push({ title: 'The same people saw it too often', detail: `Each person saw it about ${r.frequency.toFixed(1)} times.`, fix: 'Above about 3, people stop noticing an ad. Rotate the 3 new angles, and widen the audience.' });
  if (r.spend && r.results === 0) out.push({ title: `${money(r.spend, cur)} spent with no results`, detail: 'The screenshot shows no results for the money spent.', fix: 'Start again with the 7-day test below: 3 different ads, and pause the ones that bring nothing by day 3.' });
  else if (r.spend && r.results) out.push({ title: `You paid about ${money(r.spend / r.results, cur)} per result`, detail: `${money(r.spend, cur)} for ${r.results.toLocaleString('en-NG')} ${r.resultType ?? 'results'}.`, fix: /engagement|like|view|reach|visit/i.test(r.resultType ?? '') ? 'That is the price of attention; the test below measures what a customer costs.' : 'Use this as the number to beat in the 7-day test.' });
  return out;
}

export const adLaunch = {
  id: 'ad-launch',
  name: 'Ad Launch',
  priceUsd: 2,
  // ad library 0.10–0.20 + 3 staged photos 0.30 + vision and ~6 LLM calls ≈ 0.8 (the videos are rendered on our server)
  policy: { budgetUsd: 1.8 + MAIL_BUDGET_USD, allowHosts: [HOSTS.blockrun, AISA, ...(MAIL_HOST ? [MAIL_HOST] : [])] },

  async run(brief: string, opts: { orderId?: string; details?: BusinessDetails } = {}): Promise<Job> {
    const job = new Job(this.id, brief, this.policy, opts.orderId);
    try {
      job.log('researcher', 'parse', 'the offer, the goal, the budget and who buys');
      const p = parseJson<any>(await llm(job, 'researcher', [
        { role: 'system', content: 'Parse a request to run paid social ads for a small business. Reply JSON only: {"business": name, "product": the product or service to advertise, "offer": the offer in one line, "price": price exactly as stated or null, "cta": the call to action exactly as given (e.g. "Order on WhatsApp 0803 555 0142") or null, "niche": 2-4 word niche used to search an ad library (e.g. "small chops catering", "skincare"), "location": area and city, "city": city, "audience": who buys, if stated, else a short sensible guess marked "(guess)", "mood": e.g. "warm and appetising", "premium", "playful", "scene": a one-line setting for the product photo that suits it, "instagram": handle or null, "website": url or null, "whatsapp": number or null, "goal": one of messages|sales|calls|visits|followers (default messages), "budget": the ad budget exactly as stated or null}' },
        { role: 'user', content: brief },
      ], 'parse the ad brief', { model: MODELS.fast, maxTokens: 500, json: true,
        dry: () => JSON.stringify({ business: 'Tolu’s Small Chops', product: 'party trays of small chops', offer: 'Trays for 20 guests, delivered hot', price: '₦25,000', cta: 'Order on WhatsApp 0803 555 0142', niche: 'small chops catering', location: 'Surulere, Lagos', city: 'Lagos', audience: 'Lagos party hosts, office admins and brides, 25–45 (guess)', mood: 'warm and appetising', scene: 'a festive party table at golden hour', instagram: '@tolussmallchops', website: null, whatsapp: '0803 555 0142', goal: 'messages', budget: '₦5,000 a day' }) }), {});
      // their Instagram or website fills in the logo, photos, colour and WhatsApp they didn't give
      const { d, text: pageText, notes: brandNotes } = await withBrandKit(job, opts.details, { photos: 3 });
      const goals: Goal[] = ['messages', 'sales', 'calls', 'visits', 'followers'];
      const spec: Spec = {
        business: d?.name ?? p.business ?? brief.slice(0, 40), product: d?.promote ?? p.product ?? d?.offer ?? brief.slice(0, 80), offer: d?.offer ?? p.offer ?? '',
        price: d?.price ?? p.price ?? undefined, cta: p.cta ?? 'Send us a message', niche: p.niche ?? d?.offer ?? 'local business',
        location: d ? [d.area, d.city].filter(Boolean).join(', ') : p.location ?? '', area: d?.area ?? '', city: d?.city ?? p.city ?? '', audience: d?.audience ?? p.audience ?? '',
        mood: d?.tone ?? p.mood ?? 'warm', scene: p.scene ?? 'a clean, bright setting', instagram: d?.instagram ?? p.instagram ?? undefined, website: d?.website ?? p.website ?? undefined,
        whatsapp: d?.whatsapp ?? p.whatsapp ?? undefined, phone: d?.phone, address: d?.address,
        goal: d?.adGoal ?? (goals.includes(p.goal) ? p.goal : 'messages'), platforms: d?.adPlatforms?.length ? d.adPlatforms : ['meta'],
      };
      spec.budget = parseBudget(d?.adBudget ?? p.budget ?? undefined);
      if (spec.goal === 'sales' && !spec.website) spec.goal = 'messages';
      if (spec.goal === 'messages' && !spec.whatsapp && !spec.instagram) spec.goal = spec.phone ? 'calls' : spec.goal;
      // The form's call to action is exact; the button text follows the goal
      const n = spec.whatsapp ?? spec.phone;
      if (d) spec.cta = d.cta === 'call' && n ? `Call ${prettyPhone(n)}` : d.cta === 'visit' && d.address ? `Visit us: ${d.address}` : d.cta === 'website' && d.website ? `Order at ${d.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}` : d.cta === 'dm' && d.instagram ? `DM @${d.instagram}` : spec.whatsapp ? `Order on WhatsApp ${prettyPhone(spec.whatsapp)}` : spec.cta;
      const ig = spec.instagram?.replace(/^@/, '');

      // 1. What's paying in the niche: ads that have run 30+ days
      const ads: Ad[] = [];
      for (const q of [spec.niche, d?.kind && d.kind !== 'other' ? `${d.kind} ${spec.city}`.trim() : ''].filter(Boolean)) {
        if (ads.length >= 6) break; // the second, broader search only when the first came back thin
        try {
          job.log('scout', 'ads', `ads for "${q}" that have run 30+ days`);
          const r = await aisa<any>(job, 'foreplay/discovery/ads', { query: { query: q, live: true, order: 'longest_running', running_duration_min_days: 30, limit: 12 } }, { agent: 'scout', vendor: 'Foreplay ad library (AIsa)', reason: `long-running ads for "${q}"`, dry: () => dryAds(q) });
          for (const a of r?.data ?? []) {
            const text = String(a.description ?? a.headline ?? a.name ?? '').replace(/\s+/g, ' ').trim();
            const url = a.ad_library_url ?? (a.ad_id || a.id ? `https://www.facebook.com/ads/library/?id=${a.ad_id ?? a.id}` : a.link_url ?? '');
            if (!text || ads.some((x) => x.url === url || x.text === text)) continue;
            ads.push({ n: ads.length + 1, brand: a.brand_name ?? a.name ?? 'an advertiser', platform: a.publisher_platform ?? 'Meta', format: a.display_format ?? 'ad', days: num(a.running_duration?.days), text: text.slice(0, 280), cta: a.cta_title ?? undefined, url });
          }
        } catch (e) { job.log('scout', 'skip', `ad library: ${errMsg(e).slice(0, 60)}`); }
      }

      // 2. What their own ads show, read off their screenshots
      const findings: Finding[] = [];
      const shots = (d?.adResults ?? []).map((id) => readUpload(id)).filter((b): b is Buffer => !!b);
      let read: Read | undefined;
      if (shots.length) {
        job.log('analyst', 'read', `${shots.length} screenshot${shots.length === 1 ? '' : 's'} of their current ads with ${MODELS.vision.split('/')[1]}`);
        read = parseJson<Read>(await llm(job, 'analyst', [
          { role: 'system', content: 'You read screenshots of ad results from Meta Ads Manager, the Instagram/Facebook boost screen or TikTok. Copy numbers exactly as shown; leave a field out if it is not on the screen. Never estimate. Reply JSON only: {"readable": true|false, "platform": "", "objective": the campaign objective or boost goal as written, "resultType": what a result is, as written (e.g. "Messaging conversations started", "Post engagements"), "spend": number, "currency": ISO code, "reach": number, "impressions": number, "results": number, "costPerResult": number, "linkClicks": number, "ctr": percent number, "frequency": number, "days": number}' },
          { role: 'user', content: [{ type: 'text', text: 'The ad results:' }, ...shots.map((b) => ({ type: 'image_url' as const, image_url: { url: `data:image/jpeg;base64,${b.toString('base64')}` } }))] },
        ], 'read their current ad results', { model: MODELS.vision, maxTokens: 400, json: true, maxUsd: 0.06,
          dry: () => JSON.stringify({ readable: true, platform: 'Instagram boost', objective: 'More profile visits', resultType: 'Post engagements', spend: 15000, currency: 'NGN', reach: 9200, impressions: 14100, results: 410, linkClicks: 62, frequency: 1.5, days: 5 }) }), { readable: false });
        for (const k of ['spend', 'reach', 'impressions', 'results', 'costPerResult', 'linkClicks', 'ctr', 'frequency', 'days'] as const) (read as any)[k] = num((read as any)[k]);
        if (read.readable) findings.push(...diagnose(read, spec.goal));
        job.log('analyst', 'diagnose', read.readable ? `${findings.length} finding${findings.length === 1 ? '' : 's'} from fixed rules` : 'the screenshot could not be read');
      }

      // 3. Three angles, each backed by ads that kept running
      const table = ads.map((a) => `[${a.n}] ${a.brand} · ${a.platform} ${a.format}${a.days ? ` · running ${a.days} days` : ''}${a.cta ? ` · button: ${a.cta}` : ''}\n    "${a.text.slice(0, 220)}"`).join('\n');
      job.log('analyst', 'angles', ads.length ? `3 angles from ${ads.length} long-running ads` : 'no long-running ads in the library for this niche; 3 angles from the offer');
      const facts = [`Business: ${spec.business}`, `Sells: ${spec.offer}`, `Advertise: ${spec.product}`, spec.price && `Price: ${spec.price}`, `Call to action: ${spec.cta}`, spec.location && `Where: ${spec.location}`, spec.audience && `Who buys: ${spec.audience}`, d?.notes && `Owner's notes: ${d.notes}`].filter(Boolean).join('\n') + (pageText ? `\nFrom their own pages (facts you may use):\n${pageText}` : '');
      const planned = parseJson<{ angles: Angle[] }>(await llm(job, 'analyst', [
        { role: 'system', content: `You plan paid social ads for a small business. Give exactly 3 different angles (different reasons to buy, not 3 versions of one line). ${ads.length ? 'Base each on the numbered ads that have kept running (an ad that runs for months is one that pays) and cite them as numbers.' : 'There are no example ads; base them on the offer.'} Use only facts given; never invent discounts, awards, reviews or numbers. Reply JSON only: {"angles":[{"name": 2-4 words, "idea": one sentence on why it sells, "hook": the first line a viewer reads, max 8 words, "scene": a one-line setting for the product photo that fits this angle, "cites": [ad numbers]}]}` },
        { role: 'user', content: `${facts}\n\n${table || '(no example ads)'}` },
      ], 'plan 3 ad angles', { maxTokens: 900, json: true,
        dry: () => JSON.stringify({ angles: [{ name: 'The price, up front', idea: 'Party hosts are budgeting; showing the tray price first filters for buyers.', hook: 'Party for 20? ₦25,000 sorted.', scene: 'a full tray on a festive table at golden hour', cites: [2] }, { name: 'Arrives hot', idea: 'The fear with caterers is cold food and late delivery; this answers it.', hook: 'Small chops that land hot.', scene: 'steam rising from fresh puff-puff in a delivery box being opened', cites: [1] }, { name: 'The owambe moment', idea: 'Tie the tray to the moment guests reach for it.', hook: 'The tray everyone reaches for.', scene: 'hands reaching for small chops at a lively Lagos party', cites: [1, 2] }] }) }), { angles: [] });
      const angles = (planned.angles ?? []).filter((a) => a?.name && a?.hook).slice(0, 3).map((a) => ({ ...a, cites: (a.cites ?? []).filter((c) => ads.some((x) => x.n === c)) }));
      if (angles.length < 3) {
        const base: Angle[] = [{ name: 'The offer', idea: 'Lead with what they get.', hook: spec.product, scene: spec.scene, cites: [] }, { name: 'The price', idea: 'Show the price so only buyers stop.', hook: spec.price ? `${spec.product}: ${spec.price}` : spec.product, scene: spec.scene, cites: [] }, { name: 'Where to get it', idea: 'Make the next step obvious.', hook: spec.cta, scene: spec.scene, cites: [] }];
        while (angles.length < 3) angles.push(base[angles.length]);
      }

      // 4. Words for each angle, checked against the order
      job.log('writer', 'copy', 'primary text, headlines and the on-image hook for each angle');
      const written = parseJson<{ copy: Copy[] }>(await llm(job, 'writer', [
        { role: 'system', content: `Write ad copy for a small business, one block per angle, in the order given. Use only facts given (never invent prices, discounts, awards, delivery times or claims). Rules: "overlay" is the hook printed on the image, 2-6 words; "primary" is 2 primary texts for Instagram/Facebook, each under 200 characters, the first 125 characters must work alone, ending with the call to action; "headline" is 2 headlines under 40 characters; "tiktok" is a TikTok caption under 100 characters. Tone: ${spec.mood}. Reply JSON only: {"copy":[{"overlay":"","primary":["",""],"headline":["",""],"tiktok":""}]}` },
        { role: 'user', content: `${facts}\n\nAngles:\n${angles.map((a, i) => `${i + 1}. ${a.name}: ${a.idea} Hook: "${a.hook}"`).join('\n')}` },
      ], 'write the ad copy', { maxTokens: 1400, json: true,
        dry: () => JSON.stringify({ copy: [
          { overlay: 'Party for 20? Sorted.', primary: ['Puff-puff, samosa, spring rolls and gizzard for 20 guests: ₦25,000. Order on WhatsApp 0803 555 0142.', 'Hosting this weekend? One tray feeds 20 guests for ₦25,000. Order on WhatsApp 0803 555 0142.'], headline: ['Trays for 20 guests: ₦25,000', 'Small chops, sorted'], tiktok: 'Party for 20? ₦25,000 and it’s sorted. Order on WhatsApp.' },
          { overlay: 'They land hot.', primary: ['Small chops that are still hot when your guests arrive. Order on WhatsApp 0803 555 0142.', 'No cold puff-puff at your party. Order your tray on WhatsApp 0803 555 0142.'], headline: ['Delivered hot', 'Hot small chops, your party'], tiktok: 'POV: the small chops are still hot when guests arrive. Order on WhatsApp.' },
          { overlay: 'Everyone reaches first.', primary: ['The tray your guests finish before the cake comes out. Order on WhatsApp 0803 555 0142.', 'Make your tray the first thing gone. Party trays from Tolu’s Small Chops. Order on WhatsApp 0803 555 0142.'], headline: ['The tray that goes first', 'Party trays in Lagos'], tiktok: 'The tray that goes first at every owambe. Order on WhatsApp.' },
        ] }) }), { copy: [] });
      const sources = [brief, facts, spec.cta, d?.notes ?? '', pageText].join('\n');
      const allowed = new Set(digits(sources));
      const unsourced = (s: string) => digits(s).filter((x) => !allowed.has(x) && ![...allowed].some((a) => a.includes(x) && x.length >= 3));
      const issues: string[] = [];
      const copy: Copy[] = angles.map((a, i) => {
        const c = written.copy?.[i];
        const keep = (xs: string[] | undefined, max: number, fallback: string) => {
          const ok = (xs ?? []).map((x) => String(x).trim()).filter((x) => x && !unsourced(x).length).map((x) => (x.length > max ? x.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : x));
          const dropped = (xs ?? []).length - ok.length;
          if (dropped) issues.push(`angle ${i + 1}: ${dropped} line${dropped === 1 ? '' : 's'} dropped for a number that isn't in your order`);
          return ok.length ? ok : [fallback];
        };
        // the angle's own hook is checked too: a number the owner never gave must not reach the picture
        const overlay = c?.overlay && !unsourced(c.overlay).length ? c.overlay.trim() : !unsourced(a.hook).length ? a.hook : a.name;
        return { overlay: overlay.length > 40 ? a.name : overlay, primary: keep(c?.primary, 220, `${spec.product}. ${spec.cta}.`), headline: keep(c?.headline, 40, spec.business.slice(0, 40)), tiktok: keep(c?.tiktok ? [c.tiktok] : [], 100, `${spec.product}. ${spec.cta}`)[0] };
      });

      // 5. The creatives: their product, staged once per angle, typeset in two sizes
      // the brand kit already picked their photos from the Instagram on the form; only a handle in the brief is searched here
      const photo = await productPhoto(job, { upload: d?.photos?.[0], instagram: opts.details?.instagram ? undefined : ig, about: spec.product, name: spec.business });
      const { accent, onAccent } = accentFor(d?.colour);
      const logo = d?.logo ? readUpload(d.logo) : undefined;
      const priceTag = spec.price && !unsourced(spec.price).length ? spec.price : undefined;
      const short = spec.goal === 'calls' && n ? `Call ${prettyPhone(n)}` : spec.whatsapp && spec.goal === 'messages' ? 'Order on WhatsApp' : spec.cta;
      const staged: Buffer[] = [];
      for (const [i, a] of angles.entries()) {
        const prompt = `A vertical 9:16 advertising photograph of ${spec.product} for ${spec.business}, set in ${a.scene}. ${spec.mood}, premium commercial lighting, the product sharp and centred in the middle third, calm space at the top and bottom for text. Photorealistic. No text, no letters, no logos, no watermark.`;
        job.log('illustrator', 'design', `angle ${i + 1} (${a.name}): ${photo ? 'staging their product photo' : 'generating the scene'}`);
        const key = photo
          ? await editImage(job, 'illustrator', { prompt: `Keep the product from the photo exactly as it is (shape, colours, packaging, label). ${prompt}`, images: [photo], size: '1024x1792', reason: `stage the product for angle ${i + 1}` })
          : await image(job, 'illustrator', { prompt, size: '1024x1792', reason: `the scene for angle ${i + 1}` });
        job.files.push({ name: `angle-${i + 1}-clean.png`, content: key.buf });
        staged.push(key.buf);
        job.save();
        for (const [label, w, h] of [['feed', 1080, 1350], ['story', 1080, 1920]] as const) {
          const png = await htmlToPng(creative({ photo: key.buf, hook: copy[i].overlay, price: priceTag, cta: short, business: spec.business, accent, onAccent, logo, w, h, look: i }), w, h);
          job.files.push({ name: `angle-${i + 1}-${label}.jpg`, content: await toJpeg(png) });
        }
      }
      job.save();

      // 6. A video per angle, cut on the beat by our promo engine: the staged scene behind the hook, their real
      // product photo (its own pixels, not an AI copy) for the product, a layout per angle, the call to action last
      const font: Storyboard['font'] = /premium|luxur|elegant|calm/i.test(spec.mood) ? 'premium' : /playful|fun|cheer/i.test(spec.mood) ? 'playful' : 'bold';
      const lines = (t: string) => t.split(/\s+/).reduce<string[]>((acc, w) => { const last = acc[acc.length - 1]; if (last && `${last} ${w}`.length <= 22) acc[acc.length - 1] = `${last} ${w}`; else acc.push(w); return acc; }, []).slice(0, 3);
      const seedBase = ([...spec.business].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 1000) * 12;
      const area = spec.area || spec.location || undefined;
      const videos: (PromoOut | undefined)[] = [];
      for (const [i, a] of angles.entries()) {
        const real = photo ? 'photo-1' : 'scene';
        const title = spec.product.length <= 34 ? spec.product : spec.business;
        const middle: any[] = i === 0
          ? [{ type: 'product', photo: real, tag: a.name, title, price: priceTag }, priceTag ? { type: 'price', label: spec.offer || spec.product, price: priceTag } : { type: 'statement', text: copy[i].headline[0], tone: 'dark' }]
          : i === 1
            ? [{ type: 'showcase', photo: real, tag: a.name, title, note: copy[i].primary[0].split(/(?<=[.!?])\s+/)[0], price: priceTag }]
            : [{ type: 'points', title: a.name, points: [...copy[i].headline, ...copy[(i + 1) % 3].headline].filter((x, k, xs) => x.length <= 32 && xs.indexOf(x) === k).slice(0, 3), photo: real }, { type: 'product', photo: real, title, price: priceTag }];
        const board: Storyboard = { font, palette: { accent }, scenes: [{ type: 'hook', eyebrow: [spec.business, area].filter(Boolean).join(' · '), lines: lines(copy[i].overlay), tone: 'dark' }, ...middle, { type: 'cta', headline: copy[i].headline.find((h) => h.length <= 30), action: '', sub: area }] };
        try {
          const v = await promoVideo(job, {
            board, photos: [{ buf: staged[i], about: a.scene, name: 'scene' }, ...(photo ? [{ buf: photo, about: 'their own product photo', name: 'photo-1' }] : [])], logo, business: spec.business,
            cta: spec.cta, colour: accent, mood: spec.mood, seconds: 10, size: [1080, 1920], seed: seedBase + i * 5, hookPhoto: 0, label: `angle ${i + 1}`,
          });
          job.files.push({ name: `video-${i + 1}-9x16.mp4`, content: v.mp4 }, { name: `video-${i + 1}-1x1.mp4`, content: await squareOf(v.mp4) });
          videos.push(v);
        } catch (e) {
          job.log('producer', 'skip', `angle ${i + 1} video: ${errMsg(e).slice(0, 80)}`);
          issues.push(`the video for angle ${i + 1} didn't render; ask for a revision`);
          videos.push(undefined);
        }
        job.save();
      }

      // 7. Who to show it to (the model only suggests interests; location and age come from the order)
      let interests: string[] = [];
      try {
        interests = parseJson<{ interests: string[] }>(await llm(job, 'analyst', [
          { role: 'system', content: 'Suggest 3-5 Meta ads interest targets (real interest categories, 1-3 words each) for people likely to buy this. Reply JSON only: {"interests": [...]}' },
          { role: 'user', content: facts },
        ], 'suggest interests', { model: MODELS.fast, maxTokens: 150, json: true, dry: () => JSON.stringify({ interests: ['Party planning', 'Weddings', 'Nigerian cuisine', 'Event planning', 'Office administration'] }) }), { interests: [] }).interests.filter((x) => typeof x === 'string' && x.length < 40).slice(0, 5);
      } catch (e) { job.log('analyst', 'skip', `interests: ${errMsg(e).slice(0, 50)}`); }

      // 8. QA: creatives seen by a vision model, copy re-read by another model family
      const creatives = job.files.filter((f) => /^angle-\d-(feed|story)\.jpg$/.test(f.name));
      const thumbs = await Promise.all(creatives.map((f) => ffmpeg({ 'x.jpg': f.content as Buffer }, (ff, out) => ['-i', ff['x.jpg'], '-vf', 'scale=432:-1', '-q:v', '5', out], 'jpg')));
      const looks = [...creatives.map((f, k) => ({ label: f.name, jpg: thumbs[k] })), ...videos.flatMap((x, i) => (x?.stills ?? []).map((jpg, k) => ({ label: `video ${i + 1}, scene ${k + 1}`, jpg })))];
      job.log('auditor', 'look', `${thumbs.length} creatives and every scene of ${videos.filter(Boolean).length} videos with ${MODELS.vision.split('/')[1]}`);
      const v = parseJson<{ issues: string[] }>(await llm(job, 'auditor', [
        { role: 'system', content: 'You check ad creatives for a small business (feed and story images, then a still of every scene of each video ad; each image is preceded by its name). List concrete problems only: the product hard to see or distorted, garbled AI-made letters or fake logos inside the photo, text unreadable or cut off, the call to action missing, anything that looks broken. Say which image. Reply JSON only: {"issues": [short strings]} (empty if all are ready to run).' },
        { role: 'user', content: [{ type: 'text', text: `${spec.business}: ${spec.product}` }, ...looks.flatMap((x) => [{ type: 'text' as const, text: x.label }, { type: 'image_url' as const, image_url: { url: `data:image/jpeg;base64,${x.jpg.toString('base64')}` } }])] },
      ], 'look at the creatives', { model: MODELS.vision, maxTokens: 500, json: true, maxUsd: 0.2, dry: () => JSON.stringify({ issues: [] }) }), { issues: [] });
      const a = parseJson<{ issues: string[] }>(await llm(job, 'auditor', [
        { role: 'system', content: 'Check ad copy against the facts given. Flag any price, discount, delivery time, claim or fact that is not in the facts. Reply JSON only: {"issues": [short strings]}.' },
        { role: 'user', content: `Facts:\n${facts}\n\nCopy: ${JSON.stringify(copy)}` },
      ], 'check the copy for invented claims', { model: MODELS.auditor, maxTokens: 400, json: true, dry: () => JSON.stringify({ issues: [] }) }), { issues: [] });
      issues.push(...(v.issues ?? []), ...(a.issues ?? []));
      if (!videos.some(Boolean)) issues.push('no video rendered');

      // 9. The plan, in code
      const meta = META[spec.goal];
      const b = spec.budget;
      const where = spec.goal === 'visits' ? `about 5 km around ${spec.address ?? spec.location}` : spec.city && spec.area ? `${spec.city}, starting with ${spec.area} and the areas around it` : spec.location || 'where you deliver';
      const link = spec.goal === 'messages' && spec.whatsapp ? waLink(spec.whatsapp, `Hi ${spec.business}, I saw your ad`) : spec.website;
      const L: string[] = [];
      L.push(`# Ad launch: ${spec.business}`, '',
        `**3 ads ready to run on ${spec.platforms.includes('tiktok') ? (spec.platforms.includes('meta') ? 'Instagram, Facebook and TikTok' : 'TikTok') : 'Instagram and Facebook'}, a 10-second video for each, and a 7-day plan${b ? ` for ${b.text}` : ''}.** The goal: ${meta.result}${spec.goal === 'messages' && spec.whatsapp ? ` on WhatsApp (${prettyPhone(spec.whatsapp)})` : ''}.`, '');
      L.push('## Start here', '',
        `1. Open the creatives: \`angle-1-feed.jpg\`, \`angle-2-feed.jpg\`, \`angle-3-feed.jpg\` for the feed, \`video-1-9x16.mp4\` to \`video-3-9x16.mp4\` for Reels and Stories, and the \`-story.jpg\` versions for WhatsApp Status.`,
        `2. Set up one campaign with the 3 ads (steps below${b ? `, ${money(b.daily, b.currency)} a day` : ''}).`,
        `3. Reply to every message within minutes for the first week: an ad only works if the chat that follows does.`,
        `4. On day 3, pause the ad that brings the least ${meta.result}. On day 7, keep the best one running.`,
        `5. Write down the numbers each day in \`ad-tracker.csv\`.`, '');
      if (findings.length || read) {
        L.push('## What your current ads show', '');
        if (read && !read.readable) L.push('We couldn\'t read the numbers in your screenshot. Send a clearer one with a revision and we\'ll add this part.', '');
        for (const f of findings) L.push(`**${f.title}.** ${f.detail} ${f.fix}`, '');
        if (read?.readable) L.push(`_Numbers as read from your screenshot${read.platform ? ` (${read.platform})` : ''}. The verdicts come from fixed rules, not an AI's opinion._`, '');
      }
      L.push('## The 3 angles', '');
      if (ads.length) L.push(`Each angle is built on ads in your niche that have kept running for a month or more; an advertiser only keeps paying for an ad that brings customers.`, '');
      for (const [i, an] of angles.entries()) {
        const ev = an.cites.map((c) => ads.find((x) => x.n === c)!).filter(Boolean);
        L.push(`### ${i + 1}. ${an.name}`, '', an.idea, '', ...(ev.length ? [`Seen working: ${ev.map((x) => `${x.brand}${x.days ? ` (running ${x.days} days)` : ''}, “${x.text.slice(0, 90)}${x.text.length > 90 ? '…' : ''}”`).join('; ')}.`, ''] : []));
        L.push(`- **On the image:** ${copy[i].overlay}`, `- **Primary text:**`, ...copy[i].primary.map((x) => `  - ${x}`), `- **Headline:** ${copy[i].headline.join(' / ')}`, `- **Button:** ${meta.button}`, ...(spec.platforms.includes('tiktok') ? [`- **TikTok caption:** ${copy[i].tiktok}`] : []), `- **Files:** \`angle-${i + 1}-feed.jpg\` (4:5), \`angle-${i + 1}-story.jpg\` (9:16)${videos[i] ? `, \`video-${i + 1}-9x16.mp4\` (Reels, Stories, TikTok), \`video-${i + 1}-1x1.mp4\` (feed)` : ''}, \`angle-${i + 1}-clean.png\` (no text, for a normal post)`, '');
      }
      const made = videos.filter(Boolean) as PromoOut[];
      if (made.length) L.push('## The videos', '', `One 10-second video per angle, each with its own layout and motion: the angle's hook over its scene, ${photo ? 'your real product photo (not an AI copy)' : 'the product'}${priceTag ? ' and the price' : ''}, then your call to action. Cut on the beat of ${made.some((x) => x.track) ? 'licensed music' : 'an original soundtrack'}. Vertical (9:16) for Reels, Stories, TikTok and Status; square (1:1) for the feed.`, '',
        ...(made.some((x) => x.track) ? [`Music: ${[...new Set(made.map((x) => x.track && `"${x.track.title}" by ${x.track.author}`).filter(Boolean))].join(', ')}. ${MUSIC_LICENSE}`, ''] : []));
      L.push('## Who to show it to', '',
        `- **Where:** ${where}.`,
        `- **Age:** ${d?.audience ? `as you described: ${d.audience}` : 'leave it broad (18 to 65+) and let Meta find buyers; narrow it only if you know your buyers well'}.`,
        `- **Audience:** switch on Advantage+ audience.${interests.length ? ` Add these as suggestions: ${interests.join(', ')}.` : ''}`,
        `- **Placements:** Advantage+ placements, so the feed and Story sizes are both used.`, '');
      L.push('## Budget and the 7-day test', '');
      if (b) {
        L.push(`- **${money(b.daily, b.currency)} a day for 7 days** (${money(b.daily * 7, b.currency)} in total)${b.amount !== b.daily ? `, from your budget of ${b.text}` : ''}. One campaign, one ad set, 3 ads (one per angle, each with its picture and its video): Meta shifts the money towards the ad that works.`);
      } else L.push('- You didn\'t give a budget. Pick a daily amount you can afford to lose for 7 days while you learn what works; one campaign, one ad set, 3 ads (one per angle).');
      L.push(`- **Day 3:** pause any ad whose cost per ${meta.result.replace(/s$/, '')} is more than double the best ad's.`,
        `- **Day 7:** keep the best ad. If its cost per ${meta.result.replace(/s$/, '')} is one you're happy with, raise the daily budget by about 20% every 3 days. Big jumps make Meta start learning again.`,
        `- **What a result is worth:** count how many ${meta.result} turn into orders this week. That tells you what you can afford to pay for one.`,
        ...(read?.readable && read.spend && read.results && !findings.some((f) => /attention/.test(f.title)) ? [`- **Number to beat:** your current ads cost about ${money(read.spend / read.results, read.currency ?? 'NGN')} per result.`] : []), '');
      if (spec.platforms.includes('meta')) {
        L.push('## Set it up: Instagram and Facebook', '', '**In Meta Ads Manager** (adsmanager.facebook.com, or the Meta Ads Manager app):', '',
          `1. Create, then choose the **${meta.objective}** objective.`,
          `2. In the ad set, set the conversion location to **${meta.where}**${spec.goal === 'messages' && spec.whatsapp ? ` and connect ${prettyPhone(spec.whatsapp)}` : ''}${spec.goal === 'sales' && spec.website ? ` and use ${spec.website}` : ''}.`,
          `3. Budget: ${b ? `daily, ${money(b.daily, b.currency)}` : 'daily'}; schedule 7 days.`,
          `4. Audience: ${where}; Advantage+ audience on. Placements: Advantage+.`,
          `5. Add one ad per angle. Under Media, customise by placement: \`angle-N-feed.jpg\` for Feeds${made.length ? ', \`video-N-9x16.mp4\` for Stories and Reels' : ', \`angle-N-story.jpg\` for Stories and Reels'}; paste the primary text and headline; button **${meta.button}**${link ? `; link ${link}` : ''}.`,
          '6. Publish. Meta reviews ads before they run, usually within a day.', '');
        if (meta.boost) L.push(`**Quicker, from the Instagram app:** open the post, tap Boost, choose **${meta.boost}**, set the audience and budget as above. You get fewer controls than Ads Manager, but it's the right goal, not "more likes".`, '');
      }
      if (spec.platforms.includes('tiktok')) {
        L.push('## Set it up: TikTok', '', '**In TikTok Ads Manager** (ads.tiktok.com):', '',
          `1. Create a campaign with the **${spec.goal === 'followers' ? 'Community interaction' : 'Traffic'}** objective.`,
          `2. Ad group: location ${where}; ${b ? `daily budget ${money(b.daily, b.currency)}` : 'a daily budget'}; automatic placement.`,
          `3. Ads: one per video (\`video-1-9x16.mp4\` to \`video-${Math.max(1, made.length)}-9x16.mp4\`), each with its TikTok caption from above${link && spec.goal !== 'followers' ? `, and the link ${link}` : ''}. TikTok moves the budget to the one that works.`,
          '4. TikTok runs video, so the image ads are for Instagram, Facebook and WhatsApp Status.', '');
      }
      L.push('## Checks', '',
        `- Every number in the copy was matched against your order; ${issues.filter((x) => /dropped/.test(x)).length ? 'some lines were dropped (below)' : 'none were invented'}. A second AI from a different company re-read the copy for invented claims.`,
        `- A vision model looked at all ${thumbs.length} creatives and every scene of the videos: ${v.issues?.length ? v.issues.join('; ') : 'no problems found'}.`,
        `- AI photos can bend small details. Check your product looks right before you spend. A revision redoes any creative at no charge.`,
        `- Ads don't guarantee sales. The test is built so that you find out fast, and cheaply, what works.`, '');
      if (issues.length) L.push(`> QA notes: ${issues.join('; ')}.`, '');
      L.push('Files: the creatives, the videos, `ad-copy.csv` (every line, ready to paste), `ad-tracker.csv` (a 7-day log), and `ad-launch.zip` with everything.');
      job.deliverable = L.join('\n');
      job.deliverable += headsUp(brandNotes);

      const copyRows = [['angle', 'platform', 'placement', 'creative', 'primary_text', 'headline', 'button', 'link'].join(',')];
      for (const [i, an] of angles.entries()) for (const [k, pt] of copy[i].primary.entries()) {
        copyRows.push([`${i + 1}. ${an.name}`, 'Instagram/Facebook', 'feed', `angle-${i + 1}-feed.jpg`, pt, copy[i].headline[k] ?? copy[i].headline[0], meta.button, link ?? ''].map(csvCell).join(','));
        copyRows.push([`${i + 1}. ${an.name}`, 'Instagram/Facebook', 'stories and reels', videos[i] ? `video-${i + 1}-9x16.mp4` : `angle-${i + 1}-story.jpg`, pt, copy[i].headline[k] ?? copy[i].headline[0], meta.button, link ?? ''].map(csvCell).join(','));
      }
      if (spec.platforms.includes('tiktok')) for (const [i, an] of angles.entries()) copyRows.push([`${i + 1}. ${an.name}`, 'TikTok', 'in-feed', `video-${i + 1}-9x16.mp4`, copy[i].tiktok, '', '', spec.goal === 'followers' ? '' : link ?? ''].map(csvCell).join(','));
      const start = new Date(Date.now() + 86400_000);
      const tracker = [['day', 'date', 'ad', 'spend', meta.result, 'orders', 'sales', 'notes'].join(',')];
      for (let day = 0; day < 7; day++) for (const label of angles.map((an, i) => `${i + 1}. ${an.name}`)) tracker.push([day + 1, new Date(start.getTime() + day * 86400_000).toISOString().slice(0, 10), label, '', '', '', '', ''].map(csvCell).join(','));
      job.files.sort((x, y) => Number(/-clean\./.test(x.name)) - Number(/-clean\./.test(y.name))); // the finished ads first, the plain photos after
      job.files.push({ name: 'ad-copy.csv', content: copyRows.join('\n') + '\n' }, { name: 'ad-tracker.csv', content: tracker.join('\n') + '\n' });
      job.files.push({ name: 'ad-launch.zip', content: zip([...job.files.map((f) => ({ name: f.name, data: f.content })), { name: 'plan.md', data: job.deliverable }]) });

      const hard = issues.some((x) => /suspiciously/.test(x));
      job.qa = { verdict: issues.length ? 'revise' : 'pass', notes: issues.join(' | ') || 'creatives, videos and copy checked', model: `rules + ${MODELS.vision} + ${MODELS.auditor}` };
      job.status = hard ? 'failed' : 'delivered';
      if (hard) job.error = `QA failed: ${issues.join('; ')}`;
    } catch (e: any) {
      job.status = 'failed';
      job.error = errMsg(e);
      console.error('  ✗', job.error);
    }
    job.save();
    return job;
  },
};

function dryAds(q: string) {
  return { metadata: { success: true, count: 3 }, data: [
    { id: '1111', brand_name: 'Chowdeck', display_format: 'video', publisher_platform: 'instagram', description: `Hungry? ${q} delivered hot in 30 minutes. Order in the app.`, cta_title: 'Order now', running_duration: { days: 64 } },
    { id: '2222', brand_name: 'PartyTrays NG', display_format: 'image', publisher_platform: 'facebook', description: 'Small chops trays from ₦25,000. Book your date on WhatsApp.', cta_title: 'Send WhatsApp message', running_duration: { days: 41 } },
    { id: '3333', brand_name: 'Lagos Bites', display_format: 'carousel', publisher_platform: 'instagram', description: 'Owambe ready: puff-puff, samosa, spring rolls. Delivery across Lagos.', cta_title: 'Send message', running_duration: { days: 37 } },
  ] };
}
