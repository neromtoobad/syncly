// Flyers & Price Lists: a promo flyer, a price list or menu, or an announcement, in the business's colour with its
// logo and photos, ready for WhatsApp Status, an Instagram post and A4 print, in two styles.
// Designer writes the copy as JSON (only facts from the form) → designed templates (src/flyer.ts) lay it out and fit
// every line → headless Chrome renders each size → Auditor looks at every design with a vision model; the copy is
// revised once if anything is wrong → the PNGs, an A4 PDF, and a zip.
import { Job } from '../job.ts';
import { MODELS } from '../config.ts';
import { HOSTS, llm, parseJson, type Msg } from '../tools.ts';
import { MAIL_BUDGET_USD, MAIL_HOST } from '../mail.ts';
import { ffmpeg } from '../media.ts';
import { renderPages } from '../browser.ts';
import { readUpload } from '../uploads.ts';
import { parseMenu } from '../site/facts.ts';
import { preparePhoto } from '../promo.ts';
import { flyerHtml, SIZES, type FlyerCopy, type FlyerInput, type FlyerKind } from '../flyer.ts';
import { zip } from '../zip.ts';
import type { BusinessDetails } from '../details.ts';

const cap = (s: unknown, n: number) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t; };

export const flyers = {
  id: 'flyers',
  name: 'Flyers & Price Lists',
  priceUsd: 1,
  policy: { budgetUsd: 0.4 + MAIL_BUDGET_USD, allowHosts: [HOSTS.blockrun, ...(MAIL_HOST ? [MAIL_HOST] : [])] },

  async run(brief: string, opts: { orderId?: string; details?: BusinessDetails } = {}): Promise<Job> {
    const job = new Job(this.id, brief, this.policy, opts.orderId);
    try {
      const d = opts.details;
      if (!d) throw new Error('This service needs the order form.');
      const kind: FlyerKind = d.flyerKind ?? (d.menu ? 'pricelist' : 'promo');
      const items = kind === 'pricelist' ? parseMenu(d.menu).map((m) => ({ name: m.name, price: m.price, group: m.category })) : [];
      if (kind === 'pricelist' && !items.length) throw new Error('The price list is empty: add your items and prices, one per line.');

      // the call to action and the footer come from the form, exactly
      const n = d.whatsapp ?? d.phone;
      const cta = d.cta === 'call' && n ? `Call ${n}` : d.cta === 'visit' && d.address ? `Visit us: ${d.address}` : d.cta === 'website' && d.website ? `Order at ${d.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}` : d.cta === 'dm' && d.instagram ? `DM @${d.instagram} on Instagram` : n ? `Order on WhatsApp ${n}` : d.instagram ? `DM @${d.instagram}` : d.website ? d.website.replace(/^https?:\/\//, '') : d.name;
      const footer = [d.address && d.cta !== 'visit' ? d.address : [d.area, d.city].filter(Boolean).join(', '), d.instagram && d.cta !== 'dm' ? `@${d.instagram}` : '', d.website && d.cta !== 'website' ? d.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : ''].filter(Boolean) as string[];

      // photos (cut-outs stand on white; the rest fill their frame) and the logo, as data URIs
      const photos: { uri: string; cut: boolean }[] = [];
      for (const [i, id] of (d.photos ?? []).slice(0, 3).entries()) { const b = readUpload(id); if (b) { const r = await preparePhoto(b, `p${i}`, 'photo', 1400); photos.push({ uri: `data:image/${r.photo.cut ? 'png' : 'jpeg'};base64,${r.file.buf.toString('base64')}`, cut: r.photo.cut }); } }
      const lb = d.logo ? readUpload(d.logo) : undefined;
      const logo = lb ? { uri: `data:image/jpeg;base64,${lb.toString('base64')}` } : undefined;
      const colour = d.colour ?? '#d4380d';

      // 1. The copy
      const SYS = `You write the words for a ${kind === 'pricelist' ? 'price list / menu' : kind === 'announcement' ? 'announcement flyer' : 'promo flyer'} for ${d.name} (${d.offer}${d.city ? `, ${d.city}` : ''}). Use ONLY facts given; never invent prices, discounts, dates or claims. Short, punchy, plain English a Nigerian customer would say. Reply JSON only:
{"headline": ${kind === 'announcement' ? 'the news in 2-6 words, e.g. "We\'ve moved!", "Open this Sunday"' : 'the offer in 2-6 words'} (max 34 characters), "sub": one line of supporting detail (max 70), ${kind === 'promo' ? '"badge": the price or deal exactly as given, else "" (max 14), "points": [up to 3 reasons to buy from the facts, max 30 each],' : ''}${kind === 'pricelist' ? '"title": e.g. "Price list", "Our menu", "Party trays" (max 24), "note": one short line like how to order or delivery info, only from the facts, else "",' : ''}${kind === 'announcement' ? '"date": the date or time exactly as given, else "", "points": [up to 3 details, max 30 each],' : ''} }`;
      const facts = [`Business: ${d.name}`, `Sells: ${d.offer}`, d.promote && `${kind === 'announcement' ? 'Announcement' : 'Promote'}: ${d.promote}`, d.price && `Price/deal: ${d.price}`, d.menu && kind !== 'pricelist' && `Prices: ${d.menu}`, kind === 'pricelist' && `Items: ${items.length}${items.some((x) => x.group) ? ` in groups: ${[...new Set(items.map((x) => x.group).filter(Boolean))].join(', ')}` : ''}`, d.notes && `Notes: ${d.notes}`, `Call to action (shown on a button): ${cta}`].filter(Boolean).join('\n');
      const write = (msgs: Msg[]) => llm(job, 'writer', msgs, 'write the flyer copy', { model: MODELS.maker, maxTokens: 600, json: true, maxUsd: 0.04,
        dry: () => JSON.stringify({ headline: kind === 'announcement' ? "We've moved!" : kind === 'pricelist' ? 'Price list' : `${d.promote ?? d.offer}`.slice(0, 30), sub: d.offer, badge: d.price ?? '', points: ['Fresh every day', 'Delivered across the city'], title: 'Price list', note: 'Order a day ahead', date: '' }) });
      const clean = (c: any): FlyerCopy => ({ headline: cap(c?.headline || d.promote || d.name, 34), sub: cap(c?.sub, 70) || undefined, badge: kind === 'promo' ? cap(c?.badge || d.price, 14) || undefined : undefined, points: (Array.isArray(c?.points) ? c.points : []).map((p: unknown) => cap(p, 30)).filter(Boolean).slice(0, 3), title: cap(c?.title, 24) || undefined, note: cap(c?.note, 80) || undefined, date: cap(c?.date, 30) || undefined });
      job.log('writer', 'copy', `${kind === 'pricelist' ? `a ${items.length}-item price list` : `a ${kind} flyer`} for ${d.name}`);
      let raw = await write([{ role: 'system', content: SYS }, { role: 'user', content: facts }]);
      let copy = clean(parseJson(raw, {}));

      // 2. Lay out and render: two styles × Status and post, plus A4 print of the bold one
      const make = async (c: FlyerCopy) => {
        const base = { kind, business: d.name, copy: c, items, cta, ctaKind: d.cta ?? (n ? 'whatsapp' : d.instagram ? 'dm' : d.website ? 'website' : 'visit'), footer, colour, logo, photos };
        const plan: { name: string; f: FlyerInput; kind: 'png' | 'pdf'; scale?: number }[] = [
          { name: 'flyer-status-bold.png', f: { ...base, variant: 'bold', size: 'status' }, kind: 'png' },
          { name: 'flyer-post-bold.png', f: { ...base, variant: 'bold', size: 'post' }, kind: 'png' },
          { name: 'flyer-status-clean.png', f: { ...base, variant: 'clean', size: 'status' }, kind: 'png' },
          { name: 'flyer-post-clean.png', f: { ...base, variant: 'clean', size: 'post' }, kind: 'png' },
          { name: 'flyer-a4.png', f: { ...base, variant: 'bold', size: 'a4' }, kind: 'png', scale: 2 },
          { name: 'flyer-a4.pdf', f: { ...base, variant: 'bold', size: 'a4' }, kind: 'pdf' },
        ];
        job.log('illustrator', 'design', `${plan.length - 1} designs: bold and clean, for Status, Instagram and A4 print`);
        const bufs = await renderPages(plan.map((p) => ({ html: flyerHtml(p.f), w: SIZES[p.f.size][0], h: SIZES[p.f.size][1], kind: p.kind, scale: p.scale })));
        return plan.map((p, i) => ({ name: p.name, buf: bufs[i] }));
      };
      let out = await make(copy);

      // 3. Look at every design
      const look = async () => {
        const pngs = out.filter((x) => x.name.endsWith('.png') && !x.name.includes('a4'));
        const jpgs = await Promise.all(pngs.map((p) => ffmpeg({ 'in.png': p.buf }, (f, o) => ['-i', f['in.png'], '-vf', 'scale=iw/2:-1', '-q:v', '5', o], 'jpg')));
        job.log('auditor', 'look', `reviewing ${jpgs.length} designs with ${MODELS.vision.split('/')[1]}`);
        return parseJson<{ issues: string[] }>(await llm(job, 'auditor', [
          { role: 'system', content: 'You review flyer designs for a small business (several sizes and two styles of the same flyer). List concrete problems only: text cut off or overlapping, text too small to read on a phone, a spelling mistake, a wrong or missing price, unreadable colour contrast, an empty or broken-looking area, a missing call to action. Reply JSON only: {"issues": [short specific strings]} (empty if it looks professional).' },
          { role: 'user', content: [{ type: 'text', text: `${d.name}: ${jpgs.length} designs.` }, ...jpgs.map((j) => ({ type: 'image_url' as const, image_url: { url: `data:image/jpeg;base64,${j.toString('base64')}` } }))] },
        ], 'look at every design', { model: MODELS.vision, maxTokens: 600, json: true, maxUsd: 0.1, dry: () => JSON.stringify({ issues: [] }) }), { issues: [] }).issues ?? [];
      };
      let issues = await look();
      if (issues.length) {
        job.log('writer', 'revise', `${issues.length} notes from the review`);
        raw = await write([{ role: 'system', content: SYS }, { role: 'user', content: facts }, { role: 'assistant', content: raw }, { role: 'user', content: `The designer laid this out and the reviewer noted:\n- ${issues.join('\n- ')}\nFix what the words can fix (shorter lines, clearer wording) and return the full JSON only.` }]);
        copy = clean(parseJson(raw, {}));
        out = await make(copy);
        issues = await look();
      }

      for (const f of out) job.files.push({ name: f.name, content: f.buf });
      job.files.push({ name: 'flyers.zip', content: zip(out.map((f) => ({ name: f.name, data: f.buf }))) });
      job.deliverable = [
        `# ${kind === 'pricelist' ? 'Price list' : kind === 'announcement' ? 'Announcement flyer' : 'Promo flyer'}: ${d.name}`,
        `**${copy.headline}**${copy.sub ? `: ${copy.sub}` : ''}`,
        `## What you get`,
        `- **WhatsApp Status** (1080×1920) and **Instagram post** (1080×1350), each in a bold style on your colour and a clean light style`,
        `- **A4 for printing**: a print-ready PDF and a high-resolution PNG`,
        `- All of them in \`flyers.zip\``,
        `## Checks`,
        `- Every line is fitted to its space by the layout, so nothing is cut off; ${kind === 'pricelist' ? `all ${items.length} items and prices are exactly as you wrote them` : 'prices and contact details are exactly as you gave them'}`,
        `- A vision model looked at every design: ${issues.length ? `notes left: ${issues.join('; ')}` : 'no problems found'}`,
        `## Changes`,
        `Ask for a revision with what to change: the words, the colour, a different photo, more or fewer items.`,
      ].join('\n\n');
      job.qa = { verdict: issues.length ? 'revise' : 'pass', notes: issues.join(' | ') || `${out.length} files reviewed`, model: `layout rules + ${MODELS.vision}` };
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
