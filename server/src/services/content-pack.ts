// Content Pack: what's working in the customer's niche this week, then a week of posts built on it.
// Researcher parses the brief → Reader reads the business's own site → Scout pulls this week's top
// reels and TikToks for the niche, the business's own recent posts, and the longest-running ads in
// the niche (an ad that keeps running is one that pays) → Analyst names the styles that are working,
// each backed by real posts with their numbers → Writer drafts 7 posts in the business's voice →
// Illustrator makes 3 images → QA: code checks every cited example is one we actually pulled and
// every post has a hook, caption and CTA; an auditor on another model family checks for invented claims.
import { Job } from '../job.ts';
import { MODELS } from '../config.ts';
import { HOSTS, llm, parseJson, webRead, type Page } from '../tools.ts';
import { AISA, aisa } from '../sellers.ts';
import { MAIL_BUDGET_USD, MAIL_HOST } from '../mail.ts';
import type { BusinessDetails } from '../details.ts';
import { readUpload } from '../uploads.ts';
import { editImage } from '../media.ts';
import { renderPages } from '../browser.ts';
import { postHtml, POST_SIZES, type PostCard } from '../postcard.ts';
import { money } from '../flyer.ts';

type Spec = { business: string; niche: string; location: string; platforms: string[]; instagram?: string; tiktok?: string; website?: string; competitors: string[]; offer: string; audience: string; tone: string; keywords: string[] };
export type Example = { n: number; platform: string; url: string; who: string; caption: string; views?: number; likes?: number; comments?: number; audio?: string; format?: string; posted?: string };
type Post = { day: string; platform: string; format: string; hook: string; caption: string; hashtags: string[]; cta: string; shots: string[]; inspiredBy: number[]; imagePrompt?: string };

const handle = (h?: string) => h?.replace(/^@/, '').replace(/^https?:\/\/(www\.)?(instagram|tiktok)\.com\/@?/, '').replace(/\/.*$/, '').trim() || undefined;
const csvCell = (v: unknown) => { const s = v === undefined || v === null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : undefined);
const short = (n?: number) => (n === undefined ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

/** TikHub wraps TikTok's own JSON a few levels deep; find the video items wherever they are. */
function tiktokItems(d: any): any[] {
  const out: any[] = [];
  const walk = (o: any, depth: number) => {
    if (!o || depth > 6) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
    if (typeof o !== 'object') return;
    const it = o.item ?? o.aweme_info ?? o;
    if ((it.desc !== undefined || it.description !== undefined) && (it.stats || it.statistics)) { out.push(it); return; }
    for (const v of Object.values(o)) walk(v, depth + 1);
  };
  walk(d, 0);
  return out;
}

export const contentPack = {
  id: 'content-pack',
  name: 'Content Pack',
  priceUsd: 2,
  policy: { budgetUsd: 1.6 + MAIL_BUDGET_USD, allowHosts: [HOSTS.blockrun, HOSTS.blockrunArc, HOSTS.apex, AISA, ...(MAIL_HOST ? [MAIL_HOST] : [])] },

  async run(brief: string, opts: { orderId?: string; details?: BusinessDetails } = {}): Promise<Job> {
    const job = new Job(this.id, brief, this.policy, opts.orderId);
    try {
      job.log('researcher', 'parse', 'the business, its niche, where it sells and who it talks to');
      const spec = parseJson<Spec>(
        await llm(job, 'researcher', [
          { role: 'system', content: 'Parse a social-media content request from a small business. Reply JSON only: {"business": name, "niche": short niche like "small chops caterer" or "skincare brand", "location": city/country or "", "platforms": ["instagram","tiktok",...] (default ["instagram","tiktok"]), "instagram": handle or null, "tiktok": handle or null, "website": url or null, "competitors": [instagram handles of competitors, if given], "offer": what they sell (one sentence), "audience": who buys, "tone": the voice to write in (default: warm, direct, local), "keywords": [3 short search phrases a customer would use to find this kind of content, e.g. "small chops lagos", "party catering"]}' },
          { role: 'user', content: brief },
        ], 'parse the content brief', { model: MODELS.fast, maxTokens: 400, json: true,
          dry: () => JSON.stringify({ business: 'Tolu’s Small Chops', niche: 'small chops and party catering', location: 'Lagos', platforms: ['instagram', 'tiktok'], instagram: '@tolussmallchops', tiktok: null, website: 'https://tolussmallchops.com', competitors: ['@chopsbyada'], offer: 'Small chops trays and party catering for events in Lagos', audience: 'Lagos party hosts, office admins, brides', tone: 'warm, playful, Lagos English', keywords: ['small chops lagos', 'party food lagos', 'small chops tray'] }) }),
        { business: brief.slice(0, 60), niche: brief.slice(0, 60), location: '', platforms: ['instagram', 'tiktok'], competitors: [], offer: brief, audience: '', tone: 'warm and direct', keywords: [brief.slice(0, 40)] },
      );
      // The order form's values are exact: they override what was read from the brief.
      const d = opts.details;
      if (d) {
        spec.business = d.name; spec.offer = d.offer;
        spec.location = [d.area, d.city].filter(Boolean).join(', ') || spec.location;
        if (d.instagram) spec.instagram = d.instagram;
        if (d.tiktok) spec.tiktok = d.tiktok;
        if (d.website) spec.website = d.website;
        if (d.competitors?.length) spec.competitors = d.competitors;
        if (d.tone) spec.tone = d.tone;
        if (d.platforms?.length) spec.platforms = d.platforms.map((p) => ({ 'whatsapp-status': 'WhatsApp Status', x: 'X' } as Record<string, string>)[p] ?? p);
      }
      const ig = handle(spec.instagram), tt = handle(spec.tiktok);
      const keywords = (spec.keywords?.length ? spec.keywords : [spec.niche]).slice(0, 3);

      // 1. The business in its own words
      let site: Page | undefined;
      if (spec.website) {
        job.log('reader', 'read', `${spec.website} for what they sell and how they sound`);
        try { site = (await webRead(job, 'reader', [spec.website.startsWith('http') ? spec.website : `https://${spec.website}`], 'read the business\'s own site'))[0]; }
        catch (e: any) { job.log('reader', 'skip', `site unreadable (${String(e?.message ?? e).slice(0, 50)})`); }
      }

      // 2. What's working now: top reels and TikToks for the niche, their own posts, competitors, long-running ads
      const examples: Example[] = [];
      const add = (e: Omit<Example, 'n'>) => { if (e.url && !examples.some((x) => x.url === e.url)) examples.push({ ...e, n: examples.length + 1 }); };
      const attempt = async (label: string, f: () => Promise<void>) => { try { await f(); } catch (e: any) { job.log('scout', 'skip', `${label}: ${String(e?.message ?? e).slice(0, 60)}`); } };

      job.log('scout', 'trends', `this week's top reels${spec.platforms.includes('tiktok') ? ' and TikToks' : ''} for "${keywords.join('", "')}"`);
      for (const q of keywords.slice(0, 2)) await attempt(`reels "${q}"`, async () => {
        const d = await aisa<any>(job, 'instagram/reels/search', { query: { query: q } }, { agent: 'scout', vendor: 'Instagram reels search (AIsa)', reason: `top reels for "${q}"`, dry: () => dryReels(q) });
        for (const r of d?.reels ?? []) add({ platform: 'Instagram', url: r.url ?? `https://www.instagram.com/reel/${r.shortcode}/`, who: r.owner?.username ?? '', caption: String(r.caption ?? '').slice(0, 300), views: num(r.video_play_count) ?? num(r.video_view_count), likes: num(r.like_count), comments: num(r.comment_count), audio: r.clips_music_attribution_info ? (r.clips_music_attribution_info.uses_original_audio ? 'original audio' : `${r.clips_music_attribution_info.song_name} · ${r.clips_music_attribution_info.artist_name}`) : undefined, format: 'reel', posted: r.taken_at });
      });
      if (spec.platforms.includes('tiktok')) await attempt('TikTok search', async () => {
        const d = await aisa<any>(job, 'tikhub/tiktok/web/fetch_search_video', { query: { keyword: keywords[0], count: 20 } }, { agent: 'scout', vendor: 'TikTok search (AIsa TikHub)', reason: `top TikToks for "${keywords[0]}"`, dry: () => dryTiktok(keywords[0]) });
        for (const it of tiktokItems(d).slice(0, 15)) {
          const s = it.stats ?? it.statistics ?? {}, who = it.author?.uniqueId ?? it.author?.unique_id ?? '';
          add({ platform: 'TikTok', url: `https://www.tiktok.com/@${who}/video/${it.id ?? it.aweme_id}`, who, caption: String(it.desc ?? it.description ?? '').slice(0, 300), views: num(s.playCount ?? s.play_count), likes: num(s.diggCount ?? s.digg_count), comments: num(s.commentCount ?? s.comment_count), audio: it.music?.title ? `${it.music.title}${it.music.authorName ? ` · ${it.music.authorName}` : ''}` : undefined, format: 'video' });
        }
      });
      const own: Example[] = [];
      for (const [who, label] of [[ig, 'their own'], ...spec.competitors.slice(0, 2).map((c) => [handle(c), 'a competitor\'s'])] as [string | undefined, string][]) {
        if (!who) continue;
        await attempt(`@${who}`, async () => {
          job.log('scout', 'posts', `${label} recent posts: @${who}`);
          const d = await aisa<any>(job, 'instagram/user/posts', { query: { handle: who, trim: true } }, { agent: 'scout', vendor: 'Instagram posts (AIsa)', reason: `recent posts from @${who}`, dry: () => dryPosts(who) });
          for (const p of (d?.items ?? []).slice(0, 12)) {
            const e = { platform: 'Instagram', url: `https://www.instagram.com/p/${p.code}/`, who, caption: String(p.caption?.text ?? '').slice(0, 300), views: num(p.play_count) ?? num(p.ig_play_count), likes: num(p.like_count), comments: num(p.comment_count), format: p.media_type === 2 ? 'reel' : p.media_type === 8 ? 'carousel' : 'photo', posted: p.taken_at ? new Date(p.taken_at * 1000).toISOString().slice(0, 10) : undefined };
            add(e);
            if (who === ig) own.push(examples[examples.length - 1]);
          }
        });
      }
      await attempt('ad library', async () => {
        job.log('scout', 'ads', `ads in the niche that have run 30+ days (the ones that pay)`);
        const d = await aisa<any>(job, 'foreplay/discovery/ads', { query: { query: spec.niche, live: true, order: 'longest_running', running_duration_min_days: 30, limit: 12 } }, { agent: 'scout', vendor: 'Foreplay ad library (AIsa)', reason: `long-running ads for "${spec.niche}"`, dry: () => dryAds(spec.niche) });
        for (const a of (d?.data ?? []).slice(0, 8)) add({ platform: `Ad (${a.publisher_platform ?? 'Meta'})`, url: a.link_url ?? a.ad_library_url ?? (a.id ? `https://www.facebook.com/ads/library/?id=${a.id}` : ''), who: a.brand_name ?? a.name ?? '', caption: String(a.description ?? a.headline ?? a.name ?? '').slice(0, 300), format: `${a.display_format ?? 'ad'}${a.running_duration?.days ? `, running ${a.running_duration.days} days` : ''}`, audio: a.cta_title ? `CTA: ${a.cta_title}` : undefined });
      });
      if (examples.length < 4) throw new Error(`only ${examples.length} example posts came back; not enough to say what's working`);

      // 3. What's working, from the numbers
      const table = examples.map((e) => `[${e.n}] ${e.platform} ${e.format ?? ''} by @${e.who} · ${short(e.views)} views · ${short(e.likes)} likes · ${short(e.comments)} comments${e.audio ? ` · ${e.audio}` : ''}${e.posted ? ` · ${e.posted}` : ''}\n    "${e.caption.replace(/\s+/g, ' ').slice(0, 220)}"`).join('\n');
      job.log('analyst', 'analyse', `${examples.length} posts: which styles, hooks and formats are pulling views`);
      const styles = await llm(job, 'analyst', [
        { role: 'system', content: 'You are a social media strategist. From the numbered posts (real, pulled this week, with their numbers), name the 4–6 content styles that are working in this niche right now. For each: a name, what it looks like, why it works for this audience, the hook pattern (with a real example hook from the posts), the format and length, the audio approach, and cite the posts that show it as [n]. Then "What their own account shows" (if their own posts are included: what got the most and least engagement, and why), then "Posting rhythm" (how often and when, only if the data suggests it; otherwise say so). Use only what the posts show; never invent numbers. Markdown, concise.' },
        { role: 'user', content: `Business: ${spec.business} — ${spec.offer}\nNiche: ${spec.niche}${spec.location ? ` in ${spec.location}` : ''}\nAudience: ${spec.audience}\nTheir handle: ${ig ? '@' + ig : 'not given'}\n\nPosts:\n${table}` },
      ], 'name the styles that are working', { maxTokens: 1600, dry: () => `### 1. Tray-reveal POV reels\nA slow top-down reveal of a full tray, on trending audio. Works because the food sells itself. Hook: "POV: you ordered small chops for 50 guests" [1][3].\n\n### 2. Price-in-the-first-second\nThe price on screen before anything else [2].\n\n### 3. Behind-the-fryer\nFrying and packing, raw and fast [4].\n\n### 4. Event recap carousels\nSlides from a real event with the host tagged [6].\n\n**What their own account shows:** trays outperform flyers 5× [5].\n\n**Posting rhythm:** the top posts went out Thursday to Saturday.` });

      // 4. A week of posts in their voice
      job.log('writer', 'write', '7 posts in their voice, each built on a style that is working');
      const plan = parseJson<{ posts: Post[] }>(
        await llm(job, 'writer', [
          { role: 'system', content: `You write social posts for a small business, in its voice (${spec.tone}). Write 7 posts for the next 7 days across ${spec.platforms.join(' and ')}, each built on one of the working styles.${d?.goal ? ` The owner's goal: ${d.goal}; every post should push towards it.` : ''} Rules: never invent prices, discounts, awards or facts about the business that the site text or brief doesn't state (use a placeholder like [price] instead); the hook must work in the first second; the caption must end with a clear CTA (DM, WhatsApp, link in bio, order now); reels/TikToks get a shot list of 3–6 shots in "shots"; for a carousel, "shots" holds the 3–4 slide texts the audience reads after the cover (each under 70 characters, punchy, one idea per slide). Mark 3 of the posts as needing a designed image and give each an imagePrompt (describe the image only: subject, composition, light, colours; no text in the image). Reply JSON only: {"posts":[{"day":"Mon","platform":"Instagram","format":"reel|carousel|photo|story|tiktok","hook":"","caption":"","hashtags":["..."],"cta":"","shots":["..."],"inspiredBy":[example numbers],"imagePrompt":"" or null}]}` },
          { role: 'user', content: `Business: ${spec.business}\nOffer: ${spec.offer}\nAudience: ${spec.audience}\nLocation: ${spec.location}\nBrief: ${brief}\n\nTheir site says:\n${site?.text.slice(0, 3000) ?? '(no site)'}\n\nWhat's working now:\n${styles}` },
        ], 'write a week of posts', { maxTokens: 3500, json: true, dry: () => JSON.stringify({ posts: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => ({ day, platform: i % 2 ? 'TikTok' : 'Instagram', format: i % 3 === 0 ? 'reel' : i % 3 === 1 ? 'carousel' : 'photo', hook: ['POV: 50 guests and zero stress', 'Guess the price of this tray', 'What ₦[price] gets you', 'Frying at 6am so your party slaps', 'The tray that ended the argument', 'Behind every owambe', 'Your Sunday sorted'][i], caption: `Small chops that show up hot and on time. Puff-puff, samosa, spring rolls, peppered gizzard — packed for your guests. Order for your next event.`, hashtags: ['#smallchopslagos', '#lagosevents', '#partyfood'], cta: 'DM us or WhatsApp to book your tray', shots: ['Top-down tray reveal', 'Close-up puff-puff pull', 'Packing into the box', 'Delivery handover'], inspiredBy: [1 + (i % 4)], imagePrompt: i < 3 ? 'Top-down photo of a full small chops party tray on a warm wooden table, soft daylight, green and gold napkins, appetising, editorial food photography' : null })) }) }),
        { posts: [] },
      );
      const posts = (plan.posts ?? []).filter((p) => p?.hook && p?.caption).slice(0, 7);
      if (posts.length < 5) throw new Error('the writer did not return a usable week of posts');

      // 5. Three designed posts, ready to put up: their own photo restaged (the product stays exactly as it is) or,
      // with no photo, a type-led design on their colour (never a made-up product), with the hook in big type, their
      // logo, a price chip and a WhatsApp line, at the exact size each place shows it. A carousel gets its slides and
      // a closing slide that asks for the order; with WhatsApp Status chosen, every feed post gets a 9:16 version.
      const withImages = posts.filter((p) => p.imagePrompt).slice(0, 3);
      const images: { post: Post; name: string; extra: string[] }[] = [];
      const shots = d?.photos ?? [];
      const uri = (b: Buffer) => `data:image/${b[0] === 0x89 ? 'png' : 'jpeg'};base64,${b.toString('base64')}`;
      const logoBuf = d?.logo ? readUpload(d.logo) : undefined;
      const wantStatus = spec.platforms.some((x) => /whatsapp/i.test(x));
      const priceTag = d?.price ? money(d.price).slice(0, 18) : undefined;
      const ctaLine = d?.whatsapp ? `Order on WhatsApp ${d.whatsapp}` : undefined;
      if (priceTag) for (const p of posts) { p.caption = p.caption.replace(/₦?\s?\[price\]/gi, priceTag); p.hook = p.hook.replace(/₦?\s?\[price\]/gi, priceTag); }
      for (const [i, p] of withImages.entries()) {
        job.log('illustrator', 'design', `post ${i + 1} of ${withImages.length}: ${p.day} ${p.format}`);
        try {
          const tall = p.format === 'story' || /tiktok|reel/i.test(p.format);
          const own = shots.length ? readUpload(shots[i % shots.length]) : undefined;
          let photo: Buffer | undefined;
          if (own) {
            const tint = d?.colour ? ` Colour accents in ${d.colour}.` : '';
            photo = await editImage(job, 'illustrator', { prompt: `Keep the product or subject from this photo exactly as it is: same shape, labels, colours and details. Restage it for a social post: ${p.imagePrompt}.${tint} Leave calm space ${i % 3 === 1 ? 'at the top' : 'at the bottom'} for a headline. Photographic and natural, no text, no logos, no watermark.`, images: [own], size: tall ? '1024x1792' : '1024x1024', reason: `stage their photo for ${p.day}'s post` })
              .then((r) => r.buf).catch((e) => { job.log('illustrator', 'skip', `restaging failed (${String(e?.message ?? e).slice(0, 50)}); using their photo as it is`); return own; });
          }
          // a [price] the writer left for the owner becomes their real price, or comes out of the design
          const fill = (t: string) => (priceTag ? t.replace(/₦?\s?\[price\]/gi, priceTag) : t.replace(/\s*(for|at|from)?\s*₦?\s?\[price\]/gi, '').replace(/\[[^\]]*\]/g, '').replace(/\s{2,}/g, ' ').trim());
          p.hook = fill(p.hook); p.shots = (p.shots ?? []).map(fill);
          const base = { business: spec.business, colour: d?.colour, logo: logoBuf ? uri(logoBuf) : undefined, cta: ctaLine ?? p.cta.slice(0, 40), price: priceTag };
          const cover: PostCard = { ...base, size: tall ? 'story' : 'feed', kind: 'cover', photo: photo ? uri(photo) : undefined, hook: p.hook, tag: p.format === 'carousel' ? undefined : p.day, look: i };
          const slides = /carousel/i.test(p.format) ? (p.shots ?? []).map((x) => String(x).trim()).filter(Boolean).slice(0, 3) : [];
          const cards: { name: string; card: PostCard }[] = [];
          const stem = `post-${i + 1}-${p.day.toLowerCase()}`;
          if (slides.length) {
            const of = slides.length + 2;
            cards.push({ name: `${stem}-1.png`, card: { ...cover, size: 'feed', slide: { n: 1, of } } });
            slides.forEach((t, k) => cards.push({ name: `${stem}-${k + 2}.png`, card: { ...base, size: 'feed', kind: 'slide', hook: t, slide: { n: k + 2, of } } }));
            cards.push({ name: `${stem}-${of}.png`, card: { ...base, size: 'feed', kind: 'end', hook: p.cta.slice(0, 60), slide: { n: of, of } } });
          } else cards.push({ name: `${stem}.png`, card: cover });
          if (wantStatus && cover.size === 'feed') cards.push({ name: `${stem}-status.png`, card: { ...cover, size: 'story', slide: undefined } });
          const bufs = await renderPages(cards.map((c) => ({ html: postHtml(c.card), w: POST_SIZES[c.card.size][0], h: POST_SIZES[c.card.size][1], kind: 'png' as const })));
          cards.forEach((c, k) => job.files.push({ name: c.name, content: bufs[k] }));
          images.push({ post: p, name: cards[0].name, extra: cards.slice(1).map((c) => c.name) });
        } catch (e: any) { job.log('illustrator', 'skip', `post ${i + 1} failed (${String(e?.message ?? e).slice(0, 60)})`); }
      }

      // 6. QA: code first, then an auditor on another model family
      const known = new Set(examples.map((e) => e.n));
      const cited = [...styles.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
      const issues: string[] = [];
      const badCites = [...new Set(cited.filter((n) => !known.has(n)))];
      if (badCites.length) issues.push(`styles cite posts that weren't pulled: ${badCites.join(', ')}`);
      if (new Set(cited).size < 3) issues.push('fewer than 3 real posts back up the styles');
      posts.forEach((p, i) => { if (!p.cta || p.caption.length < 40) issues.push(`post ${i + 1} is missing a CTA or a real caption`); });
      job.log('auditor', 'audit', `checking the posts for invented claims with ${MODELS.auditor}`);
      const audit = parseJson<{ verdict: 'pass' | 'revise'; issues: string[] }>(
        await llm(job, 'auditor', [
          { role: 'system', content: 'You audit social posts written for a small business. Flag any post that states a price, discount, award, statistic or fact about the business that the brief and site text do not support (placeholders like [price] are fine), anything misleading or unsafe, and any style claim not backed by the cited posts. Reply JSON only: {"verdict":"pass"|"revise","issues":[short strings naming the post day]}.' },
          { role: 'user', content: `Brief: ${brief}\nSite: ${site?.text.slice(0, 2500) ?? '(none)'}\n\nStyles:\n${styles}\n\nPosts:\n${JSON.stringify(posts, null, 1).slice(0, 9000)}` },
        ], 'check the posts for invented claims', { model: MODELS.auditor, maxTokens: 600, json: true, dry: () => JSON.stringify({ verdict: 'pass', issues: [] }) }),
        { verdict: 'pass', issues: [] },
      );
      issues.push(...(audit.issues ?? []));
      if (audit.verdict === 'revise' && audit.issues?.length) {
        job.log('writer', 'revise', `${audit.issues.length} issues from the Auditor`);
        const fixed = parseJson<{ posts: Post[] }>(await llm(job, 'writer', [
          { role: 'system', content: 'Fix every auditor issue in these posts: remove or replace unsupported claims with a placeholder. Keep everything else. Reply JSON only: {"posts":[...same shape...]}' },
          { role: 'user', content: `Issues:\n- ${audit.issues.join('\n- ')}\n\nPosts:\n${JSON.stringify(posts)}` },
        ], 'fix the auditor\'s issues', { maxTokens: 3500, json: true, dry: () => JSON.stringify({ posts }) }), { posts });
        if (fixed.posts?.length === posts.length) posts.splice(0, posts.length, ...fixed.posts);
      }

      // 7. Deliver
      const topEx = [...examples].sort((a, b) => (b.views ?? b.likes ?? 0) - (a.views ?? a.likes ?? 0)).slice(0, 12);
      job.deliverable = [
        `# Content Pack: ${spec.business}`,
        `*${spec.niche}${spec.location ? ` · ${spec.location}` : ''} · ${examples.length} real posts and ads pulled this week · ${posts.length} posts ready to publish*`,
        `## What's working right now`, styles.trim(),
        `## Your week`,
        ...posts.map((p, i) => {
          const img = images.find((x) => x.post === p);
          return [`### ${p.day} · ${p.platform} ${p.format}`, `**Hook:** ${p.hook}`, '', p.caption, '', `**CTA:** ${p.cta}`, `**Hashtags:** ${(p.hashtags ?? []).join(' ')}`,
            p.shots?.length ? `**${/carousel/i.test(p.format) ? 'Slides' : 'Shots'}:**\n${p.shots.map((s, k) => `${k + 1}. ${s}`).join('\n')}` : '',
            img ? `**Design:** \`${img.name}\`${img.extra.length ? ` + ${img.extra.map((x) => `\`${x}\``).join(', ')}` : ''} (attached, ready to post)` : '', p.inspiredBy?.length ? `*Built on: ${p.inspiredBy.filter((n) => known.has(n)).map((n) => `[${n}]`).join(' ')}*` : ''].filter(Boolean).join('\n') + (i < posts.length - 1 ? '\n' : '');
        }),
        `## The posts behind this`,
        '| # | Where | Who | Views | Likes | Link |', '|---|---|---|---|---|---|',
        ...topEx.map((e) => `| ${e.n} | ${e.platform} ${e.format ?? ''} | @${e.who} | ${short(e.views)} | ${short(e.likes)} | [open](${e.url}) |`),
        `\n*Numbers are as pulled on ${new Date().toISOString().slice(0, 10)}. Trends move weekly; this pack is a snapshot.*`,
      ].join('\n\n');
      job.files.push({ name: 'posts.csv', content: ['day,platform,format,hook,caption,cta,hashtags,shots,image', ...posts.map((p) => [p.day, p.platform, p.format, p.hook, p.caption, p.cta, (p.hashtags ?? []).join(' '), (p.shots ?? []).join(' | '), images.find((x) => x.post === p)?.name ?? ''].map(csvCell).join(','))].join('\n') });
      job.files.push({ name: 'examples.csv', content: ['n,platform,format,who,views,likes,comments,audio,url,caption', ...examples.map((e) => [e.n, e.platform, e.format, e.who, e.views, e.likes, e.comments, e.audio, e.url, e.caption.replace(/\s+/g, ' ')].map(csvCell).join(','))].join('\n') });
      job.qa = { verdict: issues.length ? 'revise' : 'pass', notes: issues.join(' | ') || `${examples.length} real posts cited, ${posts.length} posts, ${images.length} images`, model: `rules + ${MODELS.auditor}` };
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

// ---------- dry-run fixtures

function dryReels(q: string) {
  const caps = ['POV: you ordered small chops for 50 guests 😮‍💨', 'Guess how much this tray costs 👀', 'Frying 400 puff-puff before 7am', 'The owambe tray that sold out', 'Lagos, what are we eating this weekend?'];
  return { reels: caps.map((c, i) => ({ shortcode: `DRY${q.length}${i}`, url: `https://www.instagram.com/reel/DRY${q.length}${i}/`, caption: c, video_play_count: [412000, 188000, 96000, 51000, 23000][i], like_count: [21000, 9400, 4100, 2600, 900][i], comment_count: [640, 820, 120, 88, 40][i], owner: { username: ['chopsbyada', 'lagosfoodie', 'puffpuffqueen', 'eventsbyremi', 'tolussmallchops'][i] }, clips_music_attribution_info: { song_name: 'Kpo Kpo', artist_name: 'Afrobeats', uses_original_audio: i === 2 }, taken_at: '2026-09-26' })) };
}
function dryTiktok(q: string) {
  return { code: 200, data: { data: [0, 1, 2].map((i) => ({ item: { id: `7420${i}${q.length}`, desc: ['Small chops for 100 guests: the math 🧮', 'Rating Lagos small chops vendors', 'Packing trays at 5am'][i], stats: { playCount: [1_200_000, 340_000, 88_000][i], diggCount: [98_000, 21_000, 5_100][i], commentCount: [2100, 900, 140][i] }, author: { uniqueId: ['lagoseats', 'foodreviewng', 'chopsbyada'][i] }, music: { title: 'original sound' } } })) } };
}
function dryPosts(who: string) {
  return { items: [0, 1, 2, 3].map((i) => ({ code: `P${who.length}${i}`, media_type: [2, 1, 8, 2][i], taken_at: 1758900000 - i * 86400 * 3, caption: { text: ['Tray of the week 🔥', 'Flyer: now taking December bookings', 'Swipe for the full menu', 'Behind the scenes at a 200-guest wedding'][i] }, play_count: i % 3 === 0 ? [14000, 0, 0, 22000][i] : undefined, like_count: [820, 60, 210, 1400][i], comment_count: [34, 2, 11, 57][i] })) };
}
function dryAds(niche: string) {
  return { metadata: { success: true, count: 2 }, data: [{ id: '1111', brand_name: 'Chowdeck', display_format: 'video', publisher_platform: 'instagram', description: `Hungry? ${niche} delivered in 30 minutes.`, cta_title: 'Order now', running_duration: { days: 64 } }, { id: '2222', brand_name: 'PartyTrays NG', display_format: 'carousel', publisher_platform: 'facebook', description: 'Trays from ₦25,000. Book your date.', cta_title: 'Send message', running_duration: { days: 41 } }] };
}
