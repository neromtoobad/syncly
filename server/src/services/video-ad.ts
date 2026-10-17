// Video Ad: a ready-to-run 9:16 video ad (and a 1:1 cut) from the customer's own product photo.
// Researcher parses the brief → Scout gets the product photo (a link they gave, or their latest
// Instagram post) → Illustrator stages it as an ad key visual (Nano Banana Pro edit; generated from
// the description when there's no photo) → Producer animates it (Seedance image-to-video; paid only
// when the clip finishes) → Writer drafts the overlay lines, hooks and ad copy from the brief only →
// the headline overlay and end card are typeset in headless Chrome, music comes from MiniMax, and
// ffmpeg cuts the final ad on our own server → QA: code checks length and size; a vision model
// looks at the opening, middle and end card; the auditor checks the copy for invented claims.
import { Job } from '../job.ts';
import { DRY, MODELS } from '../config.ts';
import { HOSTS, llm, parseJson } from '../tools.ts';
import { AISA, aisa } from '../sellers.ts';
import { download, editImage, ffmpeg, image, music, video } from '../media.ts';
import { htmlToPng } from '../browser.ts';
import { MAIL_BUDGET_USD, MAIL_HOST, PUBLIC_URL } from '../mail.ts';
import type { BusinessDetails } from '../details.ts';
import { readUpload } from '../uploads.ts';
import { palette } from '../site/color.ts';
import { igKnownMissing, isNotFound, markIgMissing, relevantPosts } from '../brandkit.ts';

type Spec = { business: string; product: string; offer: string; price?: string; cta: string; photo?: string; instagram?: string; palette: string; mood: string; scene: string };
type Copy = { overlay: string; endTitle: string; endLine: string; hooks: string[]; primary: string[]; headline: string[] };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const card = (inner: string, css: string) => `<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Geist:wght@500;600&display=block" rel="stylesheet"><style>html,body{margin:0;width:1080px;height:1920px;background:transparent}*{box-sizing:border-box}${css}</style></head><body>${inner}</body></html>`;

// ---------- shared with Ad Launch

/** Their real product photo: one they uploaded, a link they gave, or the Instagram post that best shows what they sell
 *  (never just the latest post, which is often an event or a flyer). */
export async function productPhoto(job: Job, o: { upload?: string; url?: string; instagram?: string; about?: string; name?: string }): Promise<Buffer | undefined> {
  let photo: Buffer | undefined = o.upload ? readUpload(o.upload) : undefined;
  if (photo) job.log('scout', 'photo', 'using the product photo they uploaded');
  if (!photo && o.url) {
    try { photo = await download(o.url, 12); job.log('scout', 'photo', 'using the product photo they sent'); }
    catch (e: any) { job.log('scout', 'skip', `couldn't fetch their photo (${String(e?.message ?? e).slice(0, 50)})`); }
  }
  const ig = o.instagram?.replace(/^@/, '').replace(/\/.*$/, '');
  if (!photo && ig && igKnownMissing(ig)) job.log('scout', 'skip', `no Instagram photo: there's no account @${ig}`);
  else if (!photo && ig) {
    try {
      job.log('scout', 'photo', `a photo of what they sell from @${ig}'s recent posts`);
      const d = await aisa<any>(job, 'instagram/user/posts', { query: { handle: ig, trim: true } }, { agent: 'scout', vendor: 'Instagram posts (AIsa)', reason: `a product photo from @${ig}`, dry: () => ({ items: [{ display_uri: 'dry://photo' }] }) });
      if (DRY) photo = (await image(job, 'illustrator', { prompt: 'their photo', reason: 'demo photo' })).buf;
      else {
        const posts: { buf: Buffer; caption: string; likes: number }[] = [];
        for (const x of (d?.items ?? []).slice(0, 10)) {
          const src = x.display_uri ?? x.image_versions2?.candidates?.[0]?.url;
          const buf = src ? await download(src, 12).catch(() => undefined) : undefined;
          if (buf) posts.push({ buf, caption: String(x.caption?.text ?? ''), likes: Number(x.like_count ?? 0) });
        }
        const pick = await relevantPosts(job, 'scout', posts, { name: o.name, about: o.about });
        photo = pick.length ? posts[pick[0]].buf : undefined;
        if (!photo && posts.length) job.log('scout', 'photo', `none of @${ig}'s recent posts show what they sell, so none is used`);
      }
    } catch (e: any) {
      if (!DRY && isNotFound(e)) markIgMissing(ig);
      job.log('scout', 'skip', `Instagram unavailable (${String(e?.message ?? e).slice(0, 160)})`);
    }
  }
  return photo;
}

/** The ad's accent colour: their brand colour when given, else one read from the palette words. */
export function accentFor(colour: string | undefined, words = ''): { accent: string; onAccent: string } {
  const brand = colour ? palette(colour) : undefined;
  const accent = brand?.brand ?? (/red/i.test(words) ? '#B3261E' : /green/i.test(words) ? '#1F7A3A' : /blue/i.test(words) ? '#1D4ED8' : /gold|yellow/i.test(words) ? '#B7791F' : '#13271C');
  return { accent, onAccent: brand?.onBrand ?? '#ffffff' };
}

/** Typeset the hook and the end card, add music, and cut an 8 s ad in 9:16 and 1:1, all on our server. */
export async function cutAd(job: Job, o: { clip: Buffer; overlay: string; endTitle: string; endLine: string; cta: string; accent: string; onAccent: string; logo?: Buffer; mood: string }): Promise<{ vertical: Buffer; square: Buffer; music: boolean }> {
  const { accent, onAccent, logo } = o;
  job.log('producer', 'edit', 'headline overlay, end card and music');
  const overlay = await htmlToPng(card(`<div class="t">${esc(o.overlay)}</div>`, `.t{position:absolute;left:72px;right:72px;top:210px;font:800 112px/0.98 'Bricolage Grotesque';color:#fff;letter-spacing:-0.03em;text-shadow:0 4px 40px rgba(0,0,0,.45)}`), 1080, 1920);
  const end = await htmlToPng(card(`<div class="c">${logo ? `<img class="logo" src="data:image/jpeg;base64,${logo.toString('base64')}" alt="">` : ''}<div class="n">${esc(o.endTitle)}</div><div class="l">${esc(o.endLine)}</div><div class="b">${esc(o.cta)}</div></div>`,
    `body{background:${accent}}.c{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:96px;color:${onAccent}}.logo{width:180px;height:180px;border-radius:50%;object-fit:cover;background:#fff;margin-bottom:56px}.n{font:800 118px/0.95 'Bricolage Grotesque';letter-spacing:-0.035em}.l{font:600 50px/1.2 Geist;margin-top:36px;opacity:.9}.b{margin-top:80px;align-self:flex-start;background:${onAccent};color:${accent};font:600 44px/1 Geist;padding:34px 44px;border-radius:999px}`), 1080, 1920);
  let track: Buffer | undefined;
  try { track = await music(job, 'producer', { prompt: `Short upbeat instrumental for a ${o.mood} social ad, modern Afrobeats-influenced groove, clean mix, strong start, ends on a button`, seconds: 10, reason: 'music for the ad' }); }
  catch (e: any) { job.log('producer', 'skip', `music unavailable (${String(e?.message ?? e).slice(0, 50)}); the ad will be silent`); }
  const inputs: Record<string, Buffer> = { 'clip.mp4': o.clip, 'overlay.png': overlay, 'end.png': end, ...(track ? { 'music.mp3': track } : {}) };
  const vertical = await ffmpeg(inputs, (f, out) => [
    '-i', f['clip.mp4'], '-loop', '1', '-t', '5', '-i', f['overlay.png'], '-loop', '1', '-t', '3.5', '-i', f['end.png'], ...(track ? ['-i', f['music.mp3']] : []),
    '-filter_complex',
    '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,trim=0:5,setpts=PTS-STARTPTS[v0];' +
    '[1:v]format=rgba,fade=t=in:st=0.35:d=0.45:alpha=1,fade=t=out:st=4.3:d=0.4:alpha=1[o];[v0][o]overlay=0:0:format=auto[a];' +
    '[2:v]scale=1080:1920,setsar=1,fps=30,format=yuv420p[e];[a]format=yuv420p[a2];[a2][e]xfade=transition=fade:duration=0.5:offset=4.5[v]' +
    (track ? ';[3:a]atrim=0:8,afade=t=out:st=7.2:d=0.8,loudnorm=I=-14:TP=-1.5[au]' : ''),
    '-map', '[v]', ...(track ? ['-map', '[au]'] : []), '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', ...(track ? ['-c:a', 'aac', '-b:a', '160k'] : []), '-movflags', '+faststart', '-t', '8', out,
  ]);
  // the square keeps the whole vertical frame (hook at the top, call to action at the bottom) on a blurred fill of
  // itself; a centre crop used to slice through the hook
  const square = await ffmpeg({ 'v.mp4': vertical }, (f, out) => ['-i', f['v.mp4'], '-filter_complex', '[0:v]split[a][b];[a]scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080,boxblur=24:2,eq=brightness=-0.08[bg];[b]scale=-2:1080[fg];[bg][fg]overlay=(W-w)/2:0,format=yuv420p[v]', '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out]);
  return { vertical, square, music: !!track };
}

/** The opening, the middle and the end card, for the vision check. */
export const adFrames = (vertical: Buffer) => Promise.all([0.8, 3, 7].map((t) => ffmpeg({ 'v.mp4': vertical }, (f, out) => ['-ss', String(t), '-i', f['v.mp4'], '-frames:v', '1', '-vf', 'scale=540:-1', '-q:v', '5', out], 'jpg')));

export const videoAd = {
  id: 'video-ad',
  name: 'Video Ad',
  priceUsd: 15,
  policy: { budgetUsd: 2.6 + MAIL_BUDGET_USD, allowHosts: [HOSTS.blockrun, AISA, ...(MAIL_HOST ? [MAIL_HOST] : [])] },

  async run(brief: string, opts: { orderId?: string; details?: BusinessDetails } = {}): Promise<Job> {
    const job = new Job(this.id, brief, this.policy, opts.orderId);
    try {
      job.log('researcher', 'parse', 'the product, the offer and the call to action');
      const spec = parseJson<Spec>(
        await llm(job, 'researcher', [
          { role: 'system', content: 'Parse a request for a short video ad for a small business. Reply JSON only: {"business": name, "product": the product or service to feature, "offer": the offer in one line, "price": price exactly as stated or null, "cta": the call to action exactly as given (e.g. "Order on WhatsApp 0803 555 0142"), "photo": a product photo URL if given or null, "instagram": their handle or null, "palette": brand colours if stated else "", "mood": e.g. "warm and appetising", "premium", "playful", "scene": a one-line setting for the ad that suits the product (e.g. "a party table at golden hour")}' },
          { role: 'user', content: brief },
        ], 'parse the ad brief', { model: MODELS.fast, maxTokens: 400, json: true,
          dry: () => JSON.stringify({ business: 'Tolu’s Small Chops', product: 'a party tray of small chops', offer: 'Trays for 20 guests', price: '₦25,000', cta: 'Order on WhatsApp 0803 555 0142', photo: null, instagram: '@tolussmallchops', palette: 'deep red and gold', mood: 'warm and appetising', scene: 'a festive party table at golden hour' }) }),
        { business: brief.slice(0, 40), product: brief, offer: '', cta: 'Order now', palette: '', mood: 'warm', scene: 'a clean studio set' },
      );

      // The order form's values are exact: they override what was read from the brief.
      const d = opts.details;
      if (d) {
        spec.business = d.name;
        if (d.promote) spec.product = d.promote;
        if (d.price) spec.price = d.price;
        if (d.instagram) spec.instagram = d.instagram;
        if (d.tone) spec.mood = d.tone;
        const n = d.whatsapp ?? d.phone;
        spec.cta = d.cta === 'call' && n ? `Call ${n}` : d.cta === 'visit' && d.address ? `Visit us: ${d.address}` : d.cta === 'website' && d.website ? `Order at ${d.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}` : d.cta === 'dm' && d.instagram ? `DM @${d.instagram}` : n ? `Order on WhatsApp ${n}` : spec.cta;
      }

      // 1. Their real product photo: one they uploaded, a link they gave, or their latest Instagram post
      const photo = await productPhoto(job, { upload: d?.photos?.[0], url: spec.photo, instagram: spec.instagram, about: spec.product, name: spec.business });

      // 2. The key visual (9:16), staged from their photo or generated
      const visualPrompt = `A vertical 9:16 advertising photograph of ${spec.product} for ${spec.business}, set in ${spec.scene}. ${spec.mood}, premium commercial lighting, shallow depth of field, the product sharp and centred in the middle third, calm space at the top and bottom for text. ${spec.palette ? `Colour accents: ${spec.palette}.` : ''} Photorealistic. No text, no letters, no logos, no watermark.`;
      job.log('illustrator', 'design', photo ? 'staging their product photo as an ad key visual' : 'generating the key visual');
      const key = photo
        ? await editImage(job, 'illustrator', { prompt: `Keep the product from the photo exactly as it is (shape, colours, packaging). ${visualPrompt}`, images: [photo], size: '1024x1792', reason: 'stage the product photo as a key visual' })
        : await image(job, 'illustrator', { prompt: visualPrompt, size: '1024x1792', reason: 'generate the key visual' });
      job.files.push({ name: 'key-visual.png', content: key.buf });
      job.save();

      // 3. Animate it. The seller needs a public URL for the still: theirs if they host it, else ours.
      const stillUrl = key.url ?? (opts.orderId ? `${PUBLIC_URL}/api/orders/${opts.orderId}/files/key-visual.png` : undefined);
      job.log('producer', 'animate', `5 s clip with ${'seedance-2.0-fast'}${stillUrl ? ' from the key visual' : ' (text only)'}`);
      const clip = await video(job, 'producer', {
        prompt: `${spec.product} in ${spec.scene}. Slow cinematic push-in, gentle natural motion (steam, light shimmer, a hand placing it down), the product stays sharp and unchanged, commercial quality. No text, no logos.`,
        imageUrl: stillUrl, model: 'bytedance/seedance-2.0-fast', seconds: 5, reason: 'animate the key visual',
      });

      // 4. Words: overlay, end card, and the ad copy to paste into Meta or TikTok
      job.log('writer', 'copy', 'overlay lines, hooks and ad copy');
      const copy = parseJson<Copy>(await llm(job, 'writer', [
        { role: 'system', content: 'Write copy for a short vertical video ad for a small business. Use only facts in the brief (never invent prices, discounts, awards or claims). Reply JSON only: {"overlay": a 2-5 word hook shown over the video, "endTitle": the business name or a 2-4 word line, "endLine": the offer and price if given (max 8 words), "hooks": [3 alternative first lines], "primary": [2 primary texts for Meta/Instagram, 1-2 sentences each, ending with the call to action], "headline": [2 headlines under 40 characters]}' },
        { role: 'user', content: `Business: ${spec.business}\nProduct: ${spec.product}\nOffer: ${spec.offer}\nPrice: ${spec.price ?? 'not given'}\nCall to action: ${spec.cta}\nMood: ${spec.mood}\nBrief: ${brief}` },
      ], 'write the ad copy', { maxTokens: 700, json: true, dry: () => JSON.stringify({ overlay: 'Party sorted.', endTitle: 'Tolu’s Small Chops', endLine: 'Trays for 20 guests · ₦25,000', hooks: ['Your guests will ask who catered.', 'Small chops that arrive hot.', 'The tray that ends the party debate.'], primary: ['Puff-puff, samosa and spring rolls, delivered hot for your next party. Order on WhatsApp 0803 555 0142.', 'Hosting this weekend? Trays for 20 guests at ₦25,000. Order on WhatsApp 0803 555 0142.'], headline: ['Party trays from ₦25,000', 'Small chops, delivered hot'] }) }), { overlay: spec.offer, endTitle: spec.business, endLine: spec.offer, hooks: [], primary: [], headline: [] });

      // 5. Typeset and cut (headless Chrome + ffmpeg on our server)
      const { accent, onAccent } = accentFor(d?.colour, spec.palette);
      const cut = await cutAd(job, { clip, overlay: copy.overlay, endTitle: copy.endTitle, endLine: copy.endLine, cta: spec.cta, accent, onAccent, logo: d?.logo ? readUpload(d.logo) : undefined, mood: spec.mood });
      const { vertical, square } = cut, track = cut.music;

      // 6. QA
      const frames = await adFrames(vertical);
      job.log('auditor', 'look', `checking the opening, the middle and the end card with ${MODELS.vision.split('/')[1]}`);
      const v = parseJson<{ issues: string[] }>(await llm(job, 'auditor', [
        { role: 'system', content: 'You check three frames (opening, middle, end card) of a vertical video ad for a small business. List concrete problems only: the product hard to see or distorted, garbled AI-made letters or fake logos in the picture, overlay text unreadable or cut off, the end card missing the call to action, anything that looks broken. Reply JSON only: {"issues": [short strings]} (empty if it is ready to run).' },
        { role: 'user', content: [{ type: 'text', text: `${spec.business}: ${spec.product}` }, ...frames.map((j) => ({ type: 'image_url' as const, image_url: { url: `data:image/jpeg;base64,${j.toString('base64')}` } }))] },
      ], 'look at the ad', { model: MODELS.vision, maxTokens: 500, json: true, maxUsd: 0.08, dry: () => JSON.stringify({ issues: [] }) }), { issues: [] });
      const a = parseJson<{ issues: string[] }>(await llm(job, 'auditor', [
        { role: 'system', content: 'Check ad copy against the brief. Flag any price, discount, claim or fact not in the brief. Reply JSON only: {"issues": [short strings]}.' },
        { role: 'user', content: `Brief: ${brief}\n\nCopy: ${JSON.stringify(copy)}` },
      ], 'check the copy for invented claims', { model: MODELS.auditor, maxTokens: 400, json: true, dry: () => JSON.stringify({ issues: [] }) }), { issues: [] });
      const issues = [...(v.issues ?? []), ...(a.issues ?? [])];
      if (vertical.length < 150_000) issues.push('the final video is suspiciously small');

      job.files.push({ name: 'ad-9x16.mp4', content: vertical }, { name: 'ad-1x1.mp4', content: square });
      job.deliverable = [
        `# Video ad: ${spec.business}`,
        `**8 seconds, ready to run.** \`ad-9x16.mp4\` for Reels, TikTok, Stories and WhatsApp Status; \`ad-1x1.mp4\` for the feed. \`key-visual.png\` works as a still ad.`,
        `## How it was made`,
        `- ${photo ? 'Your own product photo, staged as an ad scene' : 'A generated key visual (send a product photo next time and we\'ll use the real thing)'}, animated into a 5-second clip, then your hook, an end card with your call to action${track ? ', and music composed for it' : ''}`,
        `## Copy to paste`,
        `**Hooks (first line):**\n${copy.hooks.map((h) => `- ${h}`).join('\n')}`,
        `**Primary text:**\n${copy.primary.map((p) => `- ${p}`).join('\n')}`,
        `**Headlines:**\n${copy.headline.map((h) => `- ${h}`).join('\n')}`,
        `## Checks`,
        `- Every claim in the copy matched against your brief; the opening, middle and end card reviewed by a vision model: ${issues.length ? `open notes: ${issues.join('; ')}` : 'no problems found'}.`,
        `- AI video can bend small details; check the product looks right before you spend on it. A revision re-cuts it at no charge.`,
      ].join('\n\n');
      job.qa = { verdict: issues.length ? 'revise' : 'pass', notes: issues.join(' | ') || 'frames and copy checked', model: `rules + ${MODELS.vision} + ${MODELS.auditor}` };
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
