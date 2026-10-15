// Product Photo Studio: 1–3 phone photos of a product in, about 8 professional shots out, each sized for
// where the owner will use it. The owner's fear is that AI changes their product, so it is pinned at every
// step. Analyst (vision model) writes a fingerprint of each photo: what it is, every word on the label
// exactly as printed, colours, shape, material, camera angle; blurry, cut-off or crowded photos are set
// aside with a plain reason → the shot list comes from fixed recipes in code, chosen by where the photos
// will be used (marketplace, Instagram, WhatsApp, website) and the look (clean, lifestyle, bold); a fast
// model only picks the surface, backdrop, settings and props, as short strings that code checks →
// Illustrator remakes the owner's photo for each shot (Nano Banana Pro edit), every prompt opening with the
// fingerprint → code finishes each shot to its exact size (marketplace: background keyed to pure white,
// product re-centred) → Auditor (vision model, a different maker from the image model) looks at original and
// result side by side with fixed yes/no questions, and code decides pass or fail; a failed shot is remade
// once with a stricter prompt, then left out. At most 10 image calls per job. Code makes the before/after
// sheet, copies for social with the owner's own logo file (never drawn by AI), and a zip.
import { Job } from '../job.ts';
import { DRY, MODELS } from '../config.ts';
import { HOSTS, llm, parseJson, type Msg } from '../tools.ts';
import { SpendRefused } from '../x402.ts';
import { dataUri, editImage, ffmpeg } from '../media.ts';
import { htmlToPng } from '../browser.ts';
import { zip } from '../zip.ts';
import { MAIL_BUDGET_USD, MAIL_HOST } from '../mail.ts';
import type { BusinessDetails } from '../details.ts';
import type { Role } from '../wallets.ts';
import { readUpload } from '../uploads.ts';
import { brandCandidates, fromHex, palette, rgbToOklch } from '../site/color.ts';
import * as fx from './product-photos.fixtures.ts';
import { e164, prettyPhone } from '../site/facts.ts';
import { lum, money } from '../flyer.ts';

type Use = 'instagram' | 'whatsapp' | 'marketplace' | 'website';
type Look = 'clean' | 'lifestyle' | 'bold';
type Format = 'white' | 'square' | 'portrait' | 'story' | 'wide';
type Scene = 'white' | 'catalogue' | 'A' | 'B' | 'C' | 'D' | 'E';
const SCENES = ['A', 'B', 'C', 'D', 'E'] as const;
type YesNo = 'yes' | 'no';
export type Fingerprint = { product: string; count: number; text: string[]; colours: string[]; shape: string; material: string; angle: string; category: string; sharp: YesNo; whole: YesNo; single: YesNo; big: YesNo; lit: YesNo; notes: string };
export type Slots = { surface: string; backdrop: string; setting: string; setting2: string; setting3?: string; surface2?: string; props: string[] };
export type Answers = { same_product: string; text_same: string; colours_same: string; shape_same: string; whole: string; added_marks: string; distorted: string; scene_ok: string; notes: string };
type Photo = { n: number; src: Buffer; small: Buffer; fp?: Fingerprint; why?: string };
type Shot = { n: number; use: Use; format: Format; scene: Scene; photo: Photo; tries: number; ok?: boolean; out?: Buffer; error?: boolean; firstError?: boolean; fails: string[]; first: string[]; notes: string[] };
type About = { title: string; where: string; slug: string };
type Colours = { brand: string; brandName: string; deep: string; deepName: string; tint: string; tintName: string };

const TARGET_SHOTS = 8;
const MAX_IMAGE_CALLS = 10; // first tries and remakes together

// ---------- the design engine: our code owns the look

const FORMATS: Record<Format, { w: number; h: number; gen: string; size: string; frame: string }> = {
  white: { w: 1500, h: 1500, gen: '1024x1024', size: '1500', frame: 'Square frame. The whole product in the centre, filling about three quarters of the frame height, nothing cut off.' },
  square: { w: 1080, h: 1080, gen: '1024x1024', size: '1080', frame: 'Square frame. The product in the centre, filling about 60% of the frame, the whole product visible.' },
  portrait: { w: 1080, h: 1350, gen: '1024x1792', size: '1080x1350', frame: 'Tall frame. The whole product in the middle of the frame; keep the top and bottom sixth free of anything important, since the picture will be trimmed to 4:5.' },
  story: { w: 1080, h: 1920, gen: '1024x1792', size: '1080x1920', frame: 'Tall 9:16 frame. The whole product in the lower half of the frame; the top third is calm, empty backdrop with room for text.' },
  wide: { w: 1920, h: 1080, gen: '1792x1024', size: '1920x1080', frame: 'Wide 16:9 frame. The whole product in the right third; the left half is calm, uncluttered backdrop with room for a headline.' },
};

// Shots per use, best first. Marketplace also gets one pure-white shot per usable photo (each is an angle).
const LISTS: Record<Use, [Format, Scene][]> = {
  marketplace: [['square', 'A'], ['square', 'B'], ['square', 'catalogue'], ['square', 'C']],
  instagram: [['square', 'A'], ['portrait', 'B'], ['story', 'C'], ['portrait', 'A'], ['square', 'B'], ['square', 'C']],
  whatsapp: [['square', 'catalogue'], ['story', 'A'], ['square', 'B'], ['story', 'B']],
  website: [['wide', 'A'], ['wide', 'B'], ['white', 'white'], ['wide', 'C']],
};
const USE_NAME: Record<Use, string> = { marketplace: 'Jumia, Jiji and Konga', instagram: 'Instagram', whatsapp: 'WhatsApp', website: 'your website' };

function about(u: Use, f: Format, s: Scene): About {
  if (f === 'white') return u === 'website'
    ? { title: 'Website product photo', where: 'The product page of your website or online shop (pure white background)', slug: 'white' }
    : { title: 'Marketplace main photo', where: 'The main photo on Jumia, Jiji or Konga: pure white background, product centred', slug: 'white' };
  if (u === 'marketplace') return { title: 'Marketplace extra photo', where: 'The second or third photo on your Jumia, Jiji or Konga listing, to show the product in a setting', slug: 'listing' };
  if (u === 'whatsapp') return f === 'story'
    ? { title: 'WhatsApp Status', where: 'WhatsApp Status. Add your price or "Order now" on the calm space at the top before you post', slug: 'status' }
    : { title: s === 'catalogue' ? 'WhatsApp catalogue' : 'WhatsApp catalogue, styled', where: 'The item photo in your WhatsApp Business catalogue, or to send to customers who ask', slug: 'catalogue' };
  if (u === 'website') return { title: 'Website banner', where: 'The big picture at the top of your website. The calm space on the left is for your headline', slug: 'banner' };
  return f === 'story' ? { title: 'Instagram Story', where: 'Instagram or Facebook Stories. The calm space at the top is for stickers or text', slug: 'story' }
    : f === 'portrait' ? { title: 'Instagram feed, tall', where: 'An Instagram feed post; the tall shape fills more of the screen than a square', slug: 'feed' }
    : { title: 'Instagram post', where: 'An Instagram or Facebook post (square)', slug: 'post' };
}

/** The scene for a shot, and what the checker should see. Only the slots and colours vary. */
function scene(s: Shot, look: Look, sl: Slots, c: Colours): { text: string; check: string } {
  if (s.scene === 'white') return { text: 'Replace the background with seamless, pure white (#FFFFFF): no texture, gradient or horizon line. A soft, natural contact shadow directly under the product. Nothing else in the frame: no props, no surface, no reflections.', check: 'a plain, pure white background with nothing else in the frame' };
  if (s.scene === 'catalogue') return { text: `Clean catalogue photo: a smooth, seamless backdrop in a very light ${c.tintName} (close to ${c.tint}), soft even studio light, a gentle shadow under the product, no props.`, check: 'a plain, very light backdrop with no props' };
  const props = sl.props.slice(0, 2).join(' and ');
  const text = {
    clean: {
      A: `Soft studio scene: the product standing on ${sl.surface}, in front of a seamless ${sl.backdrop} backdrop. Large soft window light from the left, a gentle shadow, calm and minimal.`,
      B: `Minimal studio scene: the product on ${sl.surface}${sl.props[0] ? `, with ${sl.props[0]} to one side, well clear of it` : ''}. Soft daylight casting gentle window shadows across a ${sl.backdrop} backdrop.`,
      C: `The product on a simple round plinth in a soft ${c.tintName} (close to ${c.tint}), with a matching seamless backdrop, soft light from above and a gentle shadow.`,
      D: `The product on ${sl.surface} against a warm ${sl.backdrop} wall, with the soft shadow of palm fronds falling across the wall from a sunny window. Calm and minimal.`,
      E: `Top-down flat lay: the product lying on ${sl.surface2 ?? sl.surface}${sl.props[0] ? `, with ${sl.props[0]} placed neatly near one corner` : ''}. Soft, even daylight from above, a gentle shadow.`,
    },
    lifestyle: {
      A: `Real-life scene: the product ${sl.setting}. Natural daylight; the background softly out of focus so the product stands out sharp.`,
      B: `Real-life scene: the product ${sl.setting2}. Natural light, soft depth of field.`,
      C: `Close, styled scene: the product on ${sl.surface}${props ? `, with ${props} nearby, not touching it` : ''}. Soft daylight, shallow depth of field.`,
      D: `Real-life scene: the product ${sl.setting3 ?? sl.setting2}. Warm natural light, the background softly out of focus.`,
      E: `Top-down flat lay: the product on ${sl.surface2 ?? sl.surface}${props ? `, with ${props} arranged around it, none touching it` : ''}. Bright, even daylight from above.`,
    },
    bold: {
      A: `Bold, graphic scene: a solid ${c.brandName} backdrop (close to ${c.brand}) and a plinth in a slightly darker shade of the same colour. Crisp directional light with a clean, defined shadow. No props.`,
      B: `Bold colour-block scene: the back wall split into ${c.brandName} (close to ${c.brand}) and ${c.deepName} (close to ${c.deep}); the product on a ${c.deepName} surface. Crisp light, a defined shadow. No props.`,
      C: `Bold scene: a solid ${c.brandName} backdrop (close to ${c.brand}) with one large circle in a lighter shade of it behind the product. Crisp light, a defined shadow. No props.`,
      D: `Bold scene: the product on a tall ${c.deepName} pedestal (close to ${c.deep}) against a solid ${c.brandName} backdrop (close to ${c.brand}), lit from one side with a bright rim of light. No props.`,
      E: `Bold top-down shot: the product lying on a solid ${c.brandName} surface (close to ${c.brand}), crisp light from one side casting a long, hard shadow. No props.`,
    },
  }[look][s.scene as (typeof SCENES)[number]];
  const check = look === 'bold' ? `a bold ${c.brandName} backdrop` : look === 'clean' ? 'a soft, minimal studio scene' : s.scene === 'A' ? `the product ${sl.setting}` : s.scene === 'B' ? `the product ${sl.setting2}` : s.scene === 'D' ? `the product ${sl.setting3 ?? sl.setting2}` : s.scene === 'E' ? 'a top-down flat lay' : `the product on ${sl.surface}`;
  return { text, check };
}

const QUALITY = 'A professional product photograph: photorealistic, true-to-life colours, light and shadows on the product that match the scene, the product in sharp focus.';

/** Every prompt opens with this: the product exactly as the Analyst saw it. */
function pin(fp: Fingerprint): string {
  const words = fp.text.map((t) => t.trim()).filter((t) => t && !/^\[unreadable\]$/i.test(t)).slice(0, 12).map((t) => `"${t.slice(0, 80)}"`);
  const fuzzy = fp.text.some((t) => /unreadable/i.test(t));
  return [
    `Use the product from the photo exactly as it is: ${fp.product}${fp.count > 1 ? ` (${fp.count} items)` : ''}. Do not redraw, restyle, simplify, recolour, resize or reshape any part of it.`,
    `Shape and proportions: ${fp.shape}.`, `Colours: ${fp.colours.join('; ')}.`, `Material and finish: ${fp.material}.`,
    words.length ? `Its printed text must stay identical, letter for letter, in the same place, size and lettering: ${words.join(', ')}.${fuzzy ? ' Keep any smaller print exactly as in the photo too.' : ''}`
      : fuzzy ? 'Keep all printed text exactly as in the photo.' : 'It has no printed text; do not add any.',
    `Keep the camera angle of the photo (${fp.angle}).`,
    'Do not add any text, letters, numbers, logos, stickers, price tags or watermarks anywhere in the picture. No hands, no people.',
  ].join(' ');
}

// Settings and props when the stylist is unavailable, or its answer fails the checks.
// Settings Nigerian customers know (owambe tables, Lagos kitchens and balconies, ankara, adire and aso-oke, calabash,
// raffia, clay pots, rattan), not stock-photo cafés.
const DEFAULT_SLOTS: Record<string, Slots> = {
  food: { surface: 'a dark wooden table with a woven raffia mat', backdrop: 'warm terracotta wall', setting: 'on an owambe party table beside gold-rimmed trays', setting2: 'on a Lagos kitchen counter in morning light', setting3: 'on a canopy party table at an outdoor celebration', surface2: 'a woven raffia mat', props: ['a small calabash bowl', 'a folded ankara napkin', 'fresh scotch bonnet peppers'] },
  drink: { surface: 'a light stone counter', backdrop: 'soft warm grey wall', setting: 'on a party table under a white canopy', setting2: 'on a sunny balcony table in the afternoon', setting3: 'in a bowl of ice at an outdoor party', surface2: 'a woven raffia mat', props: ['ice cubes in a small glass', 'a slice of lime', 'a red hibiscus flower'] },
  skincare: { surface: 'a pale stone slab', backdrop: 'warm off-white plaster', setting: 'on a dressing table beside a folded ankara headwrap', setting2: 'on a bathroom shelf beside a folded white towel', setting3: 'on a sunlit windowsill with palm leaf shadows', surface2: 'a folded linen cloth', props: ['raw shea butter in a small calabash', 'a sprig of aloe vera', 'a smooth pebble'] },
  fashion: { surface: 'a linen-covered table', backdrop: 'soft beige wall', setting: 'on a wooden dresser beside folded ankara fabric', setting2: 'on a neatly made bed with an aso-oke throw', setting3: 'on a rattan chair in a bright room', surface2: 'folded adire fabric', props: ['folded ankara fabric', 'a woven raffia hand fan'] },
  jewellery: { surface: 'a soft taupe velvet plinth', backdrop: 'warm taupe', setting: 'on folded aso-oke fabric in soft light', setting2: 'on a dressing table beside a small ceramic dish', setting3: 'on a smooth river stone in warm light', surface2: 'a fold of cream silk', props: ['a small ceramic dish', 'a fold of aso-oke'] },
  electronics: { surface: 'a matte grey desk', backdrop: 'cool light grey wall', setting: 'on a tidy work desk in a bright Lagos apartment', setting2: 'on a living-room side table beside a rattan lamp', setting3: 'on a desk by a large sunny window', surface2: 'a light oak desk', props: ['a small potted snake plant', 'a ceramic mug'] },
  home: { surface: 'a light oak sideboard', backdrop: 'warm white wall', setting: 'in a bright living room with rattan furniture', setting2: 'on a kitchen shelf beside clay pots', setting3: 'on a sideboard beside a woven basket', surface2: 'a woven raffia mat', props: ['a potted snake plant', 'a woven basket', 'a folded adire throw'] },
  other: { surface: 'a light wooden surface', backdrop: 'soft neutral grey', setting: 'on a clean shelf in a bright Lagos room', setting2: 'on a wooden table by a window', setting3: 'on a rattan side table in daylight', surface2: 'a woven raffia mat', props: ['a small potted snake plant'] },
};
const slotKey = (category: string, kind?: string) =>
  ({ food: 'food', drink: 'drink', skincare: 'skincare', haircare: 'skincare', beauty: 'skincare', fashion: 'fashion', jewellery: 'jewellery', electronics: 'electronics', home: 'home' } as Record<string, string>)[category]
  ?? ({ food: 'food', beauty: 'skincare', health: 'skincare', retail: 'home' } as Record<string, string>)[kind ?? ''] ?? 'other';

// Nothing with writing, no people or animals, nothing that competes with the product.
const BANNED = /\b(text|words?|letters?|writing|logos?|brands?|labels?|signs?|posters?|books?|magazines?|newspapers?|menus?|cards?|prices?|screens?|phones?|laptops?|tv|hands?|person|people|m[ae]n|wom[ae]n|child(ren)?|kids?|models?|faces?|animals?|cats?|dogs?)\b/i;
function cleanSlots(raw: Partial<Slots>, base: Slots): Slots {
  const ok = (v: unknown) => (typeof v === 'string' && v.trim().length >= 3 && v.length <= 80 && !BANNED.test(v) ? v.trim().replace(/[."]+$/, '') : undefined);
  const place = (v: unknown) => { const s = ok(v); return s && /^(on|in|at|beside|by|against|inside|under|near|among)\b/i.test(s) ? s : undefined; };
  const props = (Array.isArray(raw?.props) ? raw.props : []).map(ok).filter((p): p is string => !!p).slice(0, 3);
  return { surface: ok(raw?.surface) ?? base.surface, backdrop: ok(raw?.backdrop) ?? base.backdrop, setting: place(raw?.setting) ?? base.setting, setting2: place(raw?.setting2) ?? base.setting2, setting3: place(raw?.setting3) ?? base.setting3, surface2: ok(raw?.surface2) ?? base.surface2, props: props.length ? props : base.props };
}

/** A plain colour name for prompts ("deep green"), from OKLCH lightness, chroma and hue. */
function colourName(h: string): string {
  const [L, C, H] = rgbToOklch(fromHex(h));
  if (C < 0.035) return L > 0.93 ? 'off-white' : L < 0.3 ? 'charcoal' : `${L > 0.75 ? 'light ' : ''}${H > 40 && H < 120 ? 'warm' : 'cool'} grey`;
  const name = H < 40 || H >= 345 ? (L > 0.72 ? 'pink' : 'red') : H < 75 ? (L < 0.5 ? 'brown' : 'orange') : H < 115 ? (L < 0.6 ? 'olive' : 'yellow')
    : H < 165 ? 'green' : H < 215 ? 'teal' : H < 280 ? 'blue' : H < 320 ? 'purple' : L > 0.72 ? 'pink' : 'magenta';
  return `${L < 0.4 ? 'deep ' : L > 0.88 ? 'pale ' : L > 0.75 ? 'light ' : ''}${name}`;
}
const colours = (brand: string): Colours => { const p = palette(brand); return { brand, brandName: colourName(brand), deep: p.deep, deepName: colourName(p.deep), tint: p.tint, tintName: colourName(p.tint) }; };

/** About 8 shots: the uses they asked for, in turn, then other uses if those run out. No two alike. */
function plan(uses: Use[], photos: Photo[]): Shot[] {
  const queue = (u: Use) => [
    ...(u === 'marketplace' ? photos.map((photo) => ({ format: 'white' as Format, scene: 'white' as Scene, photo })) : []),
    ...LISTS[u].map(([format, scene], k) => ({ format, scene, photo: photos[k % photos.length] })),
  ].map((x) => ({ use: u, ...x }));
  const out: Shot[] = [], seen = new Set<string>();
  const others = (['instagram', 'whatsapp', 'website', 'marketplace'] as Use[]).filter((u) => !uses.includes(u));
  for (const group of [uses, others]) {
    const qs = group.map(queue);
    while (out.length < TARGET_SHOTS && qs.some((q) => q.length)) for (const q of qs) {
      while (q.length) {
        const c = q.shift()!, key = `${c.format}:${c.scene}:${c.photo.n}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...c, n: out.length + 1, tries: 0, fails: [], first: [], notes: [] });
        break;
      }
      if (out.length >= TARGET_SHOTS) break;
    }
  }
  // one scene per shot: the styled shots take A to E in turn, so a set of 8 never repeats a setting until it must
  let k = 0;
  for (const s of out) if ((SCENES as readonly string[]).includes(s.scene)) s.scene = SCENES[k++ % SCENES.length];
  return out;
}

// ---------- the Analyst's fingerprint and the Auditor's questions

const ANALYST = `You study a small business owner's photo of a product they sell, so a designer can restage it without changing it. Describe only what you can see. Copy every piece of text on the product and its packaging exactly as printed (same spelling, capitals, numbers and symbols), one item per block of text, top to bottom; write [unreadable] for any part you cannot read with certainty. Never guess, and never correct a spelling. Reply JSON only:
{"product": what it is in one short phrase (e.g. "a 30 ml amber glass dropper bottle of face serum"),
 "count": how many of the product are in the photo,
 "text": [each block of printed text, exactly as printed],
 "colours": [each main colour and where it is, e.g. "amber glass body", "white label", "gold lettering"],
 "shape": shape and proportions, e.g. "a cylinder about three times as tall as it is wide; the black cap is a quarter of the height",
 "material": surfaces and finish, e.g. "glossy glass, matte plastic cap",
 "angle": the camera angle, e.g. "straight on, at eye level", "three-quarter view from slightly above", "top-down",
 "category": one of "food", "drink", "skincare", "haircare", "beauty", "fashion", "jewellery", "electronics", "home", "other",
 "sharp": "yes" if it is in focus enough to see its details, else "no",
 "whole": "yes" if the whole product is in the photo, "no" if the edge of the photo cuts part of it off,
 "single": "yes" if it shows one product (or one set sold together), "no" if several different products,
 "big": "yes" if the product fills at least a tenth of the photo, else "no",
 "lit": "yes" if the light is good enough to see its true colours, else "no",
 "notes": anything else that matters, e.g. "strong glare across the label", or ""}`;

const CHECKER = `You compare two pictures of a product. Image 1 is the owner's own photo. Image 2 is a new picture made from it for their shop. The owner's biggest fear is that their product was changed. Judge the product itself, not the background, and allow for different lighting. Reply JSON only:
{"same_product": "yes"|"no": is image 2 the very same product (same item, same variant, same number of items)?,
 "text_same": "yes"|"no"|"unsure"|"none": is every bit of printed text on the product identical (words, spelling, numbers)? "none" if the product has no text, "unsure" if it is too small to read,
 "colours_same": "yes"|"no": are the product's colours the same?,
 "shape_same": "yes"|"no": are its shape and proportions the same (nothing stretched, squashed, added or missing)?,
 "whole": "yes"|"no": is the whole product visible in image 2, not cut off by the edge?,
 "added_marks": "yes"|"no": does image 2 have any text, logo, sticker, price tag or watermark that is not on the original product?,
 "distorted": "yes"|"no": is anything in image 2 warped, melted, duplicated or malformed, including hands or extra copies of the product?,
 "scene_ok": "yes"|"no": does the scene in image 2 match the plan given?,
 "notes": one short line naming any difference you found, or ""}`;

const QUESTIONS: (keyof Answers)[] = ['same_product', 'text_same', 'colours_same', 'shape_same', 'whole', 'added_marks', 'distorted'];

function cleanFp(f: any): Fingerprint | undefined {
  if (!f || typeof f.product !== 'string' || !f.product.trim()) return undefined;
  const list = (v: unknown, max: number) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, max) : []);
  const str = (v: unknown, dflt: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : dflt);
  const yn = (v: unknown): YesNo => (/^n/i.test(String(v ?? '')) ? 'no' : 'yes'); // only a plain "no" sets a photo aside
  return {
    product: f.product.trim().slice(0, 200), count: Math.max(1, Math.min(50, Number(f.count) || 1)), text: list(f.text, 20), colours: list(f.colours, 8),
    shape: str(f.shape, 'as in the photo'), material: str(f.material, 'as in the photo'), angle: str(f.angle, 'as in the photo'), category: str(f.category, 'other').toLowerCase(),
    sharp: yn(f.sharp), whole: yn(f.whole), single: yn(f.single), big: yn(f.big), lit: yn(f.lit), notes: str(f.notes, ''),
  };
}
const unusable = (f: Fingerprint) =>
  f.whole === 'no' ? 'part of the product is cut off by the edge of the photo'
  : f.single === 'no' ? 'it shows several different products, so we could not tell which one to shoot'
  : f.sharp === 'no' ? "it is too blurry to see the product's details"
  : f.big === 'no' ? 'the product is too small in the photo' : undefined;

/** Code decides from the answers. Anything other than a clear good answer fails, except unreadable small print. */
function verdict(a: Partial<Answers>, white: boolean, whiteOk: boolean): { fails: string[]; notes: string[] } {
  const v = (k: keyof Answers) => String(a[k] ?? '').trim().toLowerCase();
  const fails: string[] = [], notes: string[] = [];
  if (v('same_product') !== 'yes') fails.push('it did not look like the same product');
  if (v('text_same') === 'unsure') notes.push('the small print was too small to confirm');
  else if (!['yes', 'none'].includes(v('text_same'))) fails.push('the label text changed');
  if (v('colours_same') !== 'yes') fails.push('the colours changed');
  if (v('shape_same') !== 'yes') fails.push('the shape or proportions changed');
  if (v('whole') !== 'yes') fails.push('part of the product was cut off');
  if (v('added_marks') !== 'no') fails.push('text or a mark appeared that is not on your product');
  if (v('distorted') !== 'no') fails.push('something in the picture was distorted');
  if (white && (v('scene_ok') !== 'yes' || !whiteOk)) fails.push('the background was not pure white');
  else if (!white && v('scene_ok') === 'no') notes.push('the setting came out a little different from the plan');
  return { fails, notes };
}

/** A look at images: the vision model, or the auditor's model if that seller is down. */
async function see(job: Job, agent: Role, messages: Msg[], reason: string, maxTokens: number, used: Set<string>, dry: () => string): Promise<string> {
  for (const model of [MODELS.vision, MODELS.auditor]) {
    try {
      const out = await llm(job, agent, messages, reason, { model, maxTokens, json: true, maxUsd: 0.06, dry });
      used.add(model);
      return out;
    } catch (e: any) {
      if (e instanceof SpendRefused || model === MODELS.auditor) throw e;
      job.log(agent, 'fallback', `${model.split('/')[1]} unavailable (${String(e?.message ?? e).slice(0, 50)}); asking ${MODELS.auditor.split('/')[1]}`);
    }
  }
  throw new Error('no vision model available');
}

// ---------- finishing on our own server (ffmpeg, free)

const JPEG = ['-q:v', '2', '-frames:v', '1'];
const fit = (buf: Buffer, max: number, q = 3) => ffmpeg({ in: buf }, (f, o) => ['-i', f.in, '-vf', `scale=w='min(${max},iw)':h='min(${max},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,format=yuvj420p`, '-q:v', String(q), '-frames:v', '1', o], 'jpg');
const rgb = (img: Buffer, n: number) => ffmpeg({ in: img }, (f, o) => ['-i', f.in, '-vf', `scale=${n}:${n}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-frames:v', '1', o], 'rgb');
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 255; };
const dist = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / 441.67; // 0..1, as ffmpeg's colorkey measures it

/** The exact pixel size for the shot's use: cover-crop for scenes; the marketplace shot goes on pure white. */
async function finish(img: Buffer, f: Format): Promise<{ buf: Buffer; whiteOk: boolean }> {
  const { w, h } = FORMATS[f];
  if (f === 'white') return onWhite(img, w);
  return { buf: await ffmpeg({ in: img }, (x, o) => ['-i', x.in, '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h},setsar=1,format=yuvj420p`, ...JPEG, o], 'jpg'), whiteOk: true };
}

/**
 * Marketplace main photo: turn a near-white background pure white (#fff, as Jumia asks), find the product on it,
 * and re-centre it with an even margin on a square. Only pixels close to the measured background colour change
 * (a colour key, not a curve), so the product's own colours stay exactly as made. If the background isn't
 * near-white, or the product touches an edge, it is only fitted and padded (never cropped), and the check fails it.
 */
async function onWhite(img: Buffer, size: number): Promise<{ buf: Buffer; whiteOk: boolean }> {
  const N = 200, px = await rgb(img, N), e = 6;
  const at = (x: number, y: number) => { const i = (y * N + x) * 3; return [px[i], px[i + 1], px[i + 2]]; };
  const ring: number[][] = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (x < e || y < e || x >= N - e || y >= N - e) ring.push(at(x, y));
  const light = ring.filter((p) => Math.min(...p) >= 226 && Math.max(...p) - Math.min(...p) <= 14);
  const whiteOk = light.length >= ring.length * 0.95;
  const bg = whiteOk ? [0, 1, 2].map((c) => median(light.map((p) => p[c]))) : [255, 255, 255];
  // the product and its shadow: pixels clearly apart from the background, 2+ per row and column
  const cols = new Array(N).fill(0), rows = new Array(N).fill(0);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (dist(at(x, y), bg) > 0.06) { cols[x]++; rows[y]++; }
  const x0 = cols.findIndex((c) => c >= 2), x1 = N - 1 - [...cols].reverse().findIndex((c) => c >= 2);
  const y0 = rows.findIndex((c) => c >= 2), y1 = N - 1 - [...rows].reverse().findIndex((c) => c >= 2);
  const boxed = whiteOk && x0 > 0 && y0 > 0 && x1 < N - 1 && y1 < N - 1 && x1 > x0 && y1 > y0;
  const key = whiteOk ? `format=rgba,colorkey=0x${bg.map((c) => c.toString(16).padStart(2, '0')).join('')}:0.045:0.04,` : '';
  const inner = Math.round(size * 0.84), m = 3;
  const crop = boxed ? (() => {
    const fx = Math.max(0, x0 - m) / N, fy = Math.max(0, y0 - m) / N, fw = Math.min(N, x1 + 1 + m) / N - fx, fh = Math.min(N, y1 + 1 + m) / N - fy;
    return `crop=iw*${fw.toFixed(4)}:ih*${fh.toFixed(4)}:iw*${fx.toFixed(4)}:ih*${fy.toFixed(4)},`;
  })() : '';
  // never blow a small product up more than 1.6× (it would go soft)
  const scale = boxed ? `scale=w='min(${inner},iw*1.6)':h='min(${inner},ih*1.6)':force_original_aspect_ratio=decrease:flags=lanczos` : `scale=${size}:${size}:force_original_aspect_ratio=decrease:flags=lanczos`;
  const buf = await ffmpeg({ in: img }, (f, o) => ['-i', f.in, '-f', 'lavfi', '-i', `color=c=white:s=${size}x${size},format=rgb24`, '-filter_complex',
    `[0:v]${key}${crop}${scale},format=rgba,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=white@0[p];[1:v][p]overlay=format=rgb:shortest=1,setsar=1,format=yuvj420p`, ...JPEG, o], 'jpg');
  return { buf, whiteOk };
}

/** The owner's own logo file on a white rounded tile, placed by code in a corner of the social shots. */
async function logoTile(logo: Buffer): Promise<Buffer> {
  const uri = dataUri(await fit(logo, 400), 'image/jpeg');
  return htmlToPng(`<!doctype html><html><head><style>html,body{margin:0;width:240px;height:240px;background:transparent}div{width:240px;height:240px;border-radius:44px;background:#fff;display:flex;align-items:center;justify-content:center}img{max-width:192px;max-height:192px;border-radius:20px}</style></head><body><div><img src="${uri}" alt=""></div></body></html>`, 240, 240);
}
async function stamp(img: Buffer, tile: Buffer, f: Format): Promise<Buffer> {
  const { w, h } = FORMATS[f];
  const s = Math.round(w * 0.12), m = Math.round(w * 0.04), bottom = f === 'story' ? Math.round(h * 0.12) : m; // clear of the Status reply bar
  return ffmpeg({ in: img, 'tile.png': tile }, (x, o) => ['-i', x.in, '-i', x['tile.png'], '-filter_complex', `[0:v]format=rgb24[m];[1:v]scale=${s}:${s},format=rgba[t];[m][t]overlay=W-w-${m}:H-h-${bottom}:format=rgb,format=yuvj420p`, ...JPEG, o], 'jpg');
}

/** A "ready to sell" copy: the shot with their price and WhatsApp number set on it by code (never drawn by AI), the
 *  logo if they have one. Feed shapes get a bar at the foot; a Status or Story gets it in the calm space at the top. */
async function sellCopy(img: Buffer, f: Format, o: { price?: string; phone?: string; logo?: Buffer; business: string; colour: string }): Promise<Buffer> {
  const { w, h } = FORMATS[f], tall = f === 'story', u = w / 100;
  const on = lum(o.colour) > 0.45 ? '#141414' : '#ffffff';
  const logo = o.logo ? `<img class="logo" src="${dataUri(await fit(o.logo, 300), 'image/jpeg')}" alt="">` : '';
  const wa = o.phone ? `<div class="wa"><svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.2 13.9c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2.1 1-2.4c.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .6l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.4 1.8 2.2 1.2 1.1 2.3 1.4 2.6 1.6.3.1.5.1.7-.1l.9-1.1c.2-.3.4-.2.7-.1l1.9.9c.3.1.5.2.5.3.1.2.1.6-.1 1.2z"/></svg><span>Order: ${esc(o.phone)}</span></div>` : '';
  const html = `<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=Geist:wght@600;700&display=block" rel="stylesheet"><style>
*{box-sizing:border-box;margin:0}html,body{width:${w}px;height:${h}px;overflow:hidden;font-family:Geist,Arial,sans-serif}
.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.scrim{position:absolute;inset:0;background:${tall ? 'linear-gradient(180deg,rgba(0,0,0,.55) 0%,rgba(0,0,0,0) 34%)' : 'linear-gradient(180deg,rgba(0,0,0,0) 58%,rgba(0,0,0,.6) 100%)'}}
.box{position:absolute;left:${5 * u}px;right:${5 * u}px;${tall ? `top:${12 * u}px` : `bottom:${5 * u}px`};display:flex;flex-direction:column;align-items:flex-start;gap:${2.2 * u}px}
.who{display:flex;align-items:center;gap:${2 * u}px;color:#fff;font-weight:700;font-size:${3.4 * u}px;text-shadow:0 2px 12px rgba(0,0,0,.4)}
.logo{width:${9 * u}px;height:${9 * u}px;border-radius:${2.4 * u}px;object-fit:contain;background:#fff;padding:${0.7 * u}px}
.price{background:${o.colour};color:${on};font-family:'Bricolage Grotesque',Arial,sans-serif;font-weight:800;font-size:${(tall ? 9 : 7.5) * u}px;line-height:1;padding:${1.6 * u}px ${3.2 * u}px;border-radius:${2.4 * u}px;box-shadow:0 ${u}px ${3 * u}px rgba(0,0,0,.3);max-width:100%;white-space:nowrap;overflow:hidden}
.wa{display:flex;align-items:center;gap:${1.4 * u}px;background:#25d366;color:#fff;font-weight:700;font-size:${3.8 * u}px;padding:${1.8 * u}px ${3 * u}px;border-radius:999px;box-shadow:0 ${u}px ${3 * u}px rgba(0,0,0,.25)}
.wa svg{width:${4.8 * u}px;height:${4.8 * u}px;fill:currentColor}
</style></head><body><img class="bg" src="${dataUri(img, 'image/jpeg')}" alt=""><div class="scrim"></div>
<div class="box"><div class="who">${logo}<span>${esc(o.business)}</span></div>${o.price ? `<div class="price">${esc(o.price)}</div>` : ''}${wa}</div></body></html>`;
  const png = await htmlToPng(html, w, h);
  return ffmpeg({ 'in.png': png }, (x, out) => ['-i', x['in.png'], '-vf', 'format=yuvj420p', ...JPEG, out], 'jpg');
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Before and after on one image, so the job page opens on it. */
async function contactSheet(name: string, photos: Photo[], done: { s: Shot; a: About }[]): Promise<Buffer> {
  const W = 1600, P = 64, G = 24, cols = 4, tile = Math.floor((W - 2 * P - (cols - 1) * G) / cols), cap = 56;
  const rows = Math.ceil(done.length / cols);
  const H = 2 * P + 96 + 40 + 42 + 320 + 56 + 42 + rows * (tile + cap) + (rows - 1) * G;
  const uri = async (b: Buffer) => dataUri(await fit(b, 720), 'image/jpeg');
  const used = photos.filter((p) => !p.why).length;
  const before = await Promise.all(photos.map(async (p) => `<figure class="b"><img src="${await uri(p.small)}" alt="">${p.why ? `<span class="tag">Not used: ${esc(p.why)}</span>` : ''}</figure>`));
  const after = await Promise.all(done.map(async ({ s, a }, i) => `<figure><div class="t"><img src="${await uri(s.out!)}" alt=""></div><figcaption><b>${i + 1} · ${esc(a.title)}</b><span>${FORMATS[s.format].w} × ${FORMATS[s.format].h}</span></figcaption></figure>`));
  const html = `<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600&display=block" rel="stylesheet"><style>
*{box-sizing:border-box;margin:0}html,body{width:${W}px;height:${H}px;background:#F5F3EF;color:#1B1A17;font-family:Geist,'Helvetica Neue',Arial,sans-serif}body{padding:${P}px}
header{height:96px;margin-bottom:40px}h1{font-size:40px;font-weight:600;letter-spacing:-0.02em;line-height:52px}header p{font-size:20px;line-height:32px;margin-top:8px;color:#6B675F}
h2{height:42px;font-size:15px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#6B675F}.row{display:flex;gap:${G}px;height:320px;overflow:hidden}
.b{position:relative;height:320px}.b img{height:320px;max-width:475px;object-fit:cover;border-radius:12px;display:block}
.tag{position:absolute;left:12px;right:12px;bottom:12px;background:rgba(27,26,23,.82);color:#fff;font-size:14px;line-height:20px;padding:8px 10px;border-radius:8px}
.gap{height:56px}.grid{display:grid;grid-template-columns:repeat(${cols},${tile}px);gap:${G}px}
.t{width:${tile}px;height:${tile}px;background:#fff;border:1px solid #E6E2DA;border-radius:12px;display:flex;align-items:center;justify-content:center;overflow:hidden}.t img{max-width:100%;max-height:100%;display:block}
figcaption{height:${cap}px;padding-top:12px;display:flex;justify-content:space-between;gap:12px;font-size:15px;line-height:20px}figcaption span{color:#6B675F;white-space:nowrap}
</style></head><body><header><h1>${esc(name)}: before and after</h1><p>${done.length} shot${done.length === 1 ? '' : 's'} made from your own photo${used === 1 ? '' : 's'}, each checked against the original</p></header>
<h2>Your photo${photos.length === 1 ? '' : 's'}</h2><div class="row">${before.join('')}</div><div class="gap"></div><h2>What you get</h2><div class="grid">${after.join('')}</div></body></html>`;
  const png = await htmlToPng(html, W, H);
  return ffmpeg({ 'in.png': png }, (f, o) => ['-i', f['in.png'], '-vf', 'format=yuvj420p', '-q:v', '3', '-frames:v', '1', o], 'jpg');
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const msg = (e: any) => String(e?.message ?? e).slice(0, 60);

export const productPhotos = {
  id: 'product-photos',
  name: 'Product Photo Studio',
  priceUsd: 2,
  policy: { budgetUsd: 1.5 + MAIL_BUDGET_USD, allowHosts: [HOSTS.blockrun, ...(MAIL_HOST ? [MAIL_HOST] : [])] },

  async run(brief: string, opts: { orderId?: string; details?: BusinessDetails } = {}): Promise<Job> {
    const job = new Job(this.id, brief, this.policy, opts.orderId);
    try {
      // The photos are the job: without one there is nothing to stay true to, so stop before spending anything.
      const d = opts.details;
      const ids = d?.photos ?? [];
      const raw = ids.slice(0, 3).map((id) => readUpload(id)).filter((b): b is Buffer => !!b);
      if (!raw.length) throw new Error('Product Photo Studio works from your own photos: upload 1 to 3 clear phone photos of the product on the order form, and we will make the professional shots from them.');
      if (ids.length > 3) job.log('analyst', 'photos', `using the first 3 of the ${ids.length} photos`);
      const uses = [...new Set(d?.uses?.length ? d.uses : ['instagram', 'whatsapp'])] as Use[];
      const look: Look = d?.look ?? 'clean';
      const revision = brief.match(/Revision requested by the customer:\s*([\s\S]+)$/)?.[1]?.trim();
      const owner = [d?.product && `The owner says the photos show: ${d.product}.`, d?.notes && `Owner's notes: ${d.notes}`, revision && `Revision request: ${revision}`].filter(Boolean).join('\n');
      const checkers = new Set<string>();

      // 1. The product's fingerprint, photo by photo
      const photos: Photo[] = await Promise.all(raw.map(async (b, i) => ({ n: i + 1, src: await fit(b, 2048, 2), small: await fit(b, 1024) })));
      await Promise.all(photos.map(async (p, i) => {
        job.log('analyst', 'look', `photo ${p.n}: what it is, every word on the label, colours, shape`);
        try {
          const out = await see(job, 'analyst', [
            { role: 'system', content: ANALYST },
            { role: 'user', content: [{ type: 'text', text: `Photo ${p.n} of ${photos.length}.${owner ? `\n${owner}\n(This may help you read the label, but describe only what you can see.)` : ''}` }, { type: 'image_url', image_url: { url: dataUri(await fit(raw[i], 1568), 'image/jpeg') } }] },
          ], `fingerprint the product in photo ${p.n}`, 900, checkers, () => JSON.stringify(fx.fingerprint(i)));
          p.fp = cleanFp(parseJson(out, {}));
          p.why = p.fp ? unusable(p.fp) : 'we could not make out the product in it';
        } catch (e: any) {
          if (e instanceof SpendRefused) throw e;
          p.why = `we could not study it (${msg(e)})`;
        }
        if (p.why) job.log('analyst', 'set aside', `photo ${p.n}: ${p.why}`);
      }));
      const usable = photos.filter((p) => p.fp && !p.why);
      if (!usable.length) throw new Error(`None of the photos could be used (${photos.map((p) => `photo ${p.n}: ${p.why}`).join('; ')}). Please send a sharp photo of the whole product, in good light, with only that product in it.`);
      const main = usable[0].fp!;

      // 2. The shot list (code), with props and settings picked to suit the product (a fast model, short checked strings)
      const base = DEFAULT_SLOTS[slotKey(main.category, d?.kind)];
      let slots = base;
      if (look !== 'bold') {
        job.log('illustrator', 'style', `surface, backdrop, settings and props that suit ${main.product}`);
        try {
          slots = cleanSlots(parseJson(await llm(job, 'illustrator', [
            { role: 'system', content: `You are a product photo stylist for small businesses in Nigeria. Pick where to photograph the product for a ${look} look. Keep every answer a short phrase (at most 8 words). Choose real, everyday Nigerian settings and things that suit the product and its customers: owambe and party tables, Lagos kitchens, living rooms and balconies, market stalls, ankara, adire and aso-oke fabric, calabash, raffia, clay pots, rattan, palm fronds. No western stock-photo clichés. Never anything with writing on it (books, menus, packaging, signs, screens), no other products or brands, no people, hands or animals, and nothing that could be mistaken for the product. Reply JSON only: {"surface": what the product stands on, "backdrop": the wall or background behind it, "setting": a real place where it is used, starting with "on" or "in" (e.g. "on a bathroom shelf beside a folded towel"), "setting2": a second, different real place, starting with "on" or "in", "setting3": a third, different real place, starting with "on" or "in", "surface2": a surface for a top-down flat lay, "props": [up to 3 small props that suit it]}` },
            { role: 'user', content: `Product: ${main.product}\nBusiness: ${d?.kind ?? 'other'}, sells ${d?.offer ?? 'this product'}${owner ? `\n${owner}` : ''}` },
          ], 'pick a setting and props that suit the product', { model: MODELS.fast, maxTokens: 300, json: true, dry: () => JSON.stringify(fx.slots()) }), {}), base);
        } catch (e: any) {
          if (e instanceof SpendRefused) throw e;
          job.log('illustrator', 'skip', `stylist unavailable (${msg(e)}); using our standard set`);
        }
      }
      const brandHex = d?.colour ?? (await brandCandidates(usable.map((p) => ({ buf: p.small }))).catch(() => [] as string[]))[0] ?? '#2f5d50';
      const col = colours(brandHex);
      const shots = plan(uses, usable);
      job.log('illustrator', 'plan', `${shots.length} shots for ${list(uses.map((u) => USE_NAME[u]))}, ${look} look: ${shots.map((s) => about(s.use, s.format, s.scene).title).join(', ')}`);

      // 3–4. Make each shot from their photo, finish it to size, check it beside the original
      let calls = 0, stopped = '', toolError = '';
      const attempt = async (s: Shot, again: boolean) => {
        if (stopped || calls >= MAX_IMAGE_CALLS) return;
        calls++;
        s.tries++;
        const strict = again && !s.error && s.fails.length > 0;
        const a = about(s.use, s.format, s.scene), sc = scene(s, look, slots, col), fp = s.photo.fp!;
        const prompt = [
          pin(fp),
          strict ? `IMPORTANT: an earlier try changed the product (${s.fails.join('; ')}). Treat the product as a fixed cut-out from the photo: keep every part of it exactly as photographed, including every letter of the label, and change only what is around it.` : '',
          `Scene: ${sc.text}${strict ? ' Keep the scene simple, with nothing touching or overlapping the product.' : ''}`,
          revision && s.scene !== 'white' ? `The owner asked for changes (apply them to the scene only; never to the product, and never add text): ${revision.slice(0, 300)}` : '',
          `Framing: ${FORMATS[s.format].frame}`, QUALITY,
        ].filter(Boolean).join('\n\n');
        job.log('illustrator', again ? 'redo' : 'design', again ? `shot ${s.n} again${strict ? `, stricter: ${s.fails.join('; ')}` : ''}` : `shot ${s.n} of ${shots.length}: ${a.title} from photo ${s.photo.n}`);
        try {
          const made = await editImage(job, 'illustrator', { prompt, images: [s.photo.src], size: FORMATS[s.format].gen, reason: `${again ? 'remake' : 'make'} shot ${s.n}: ${a.title.toLowerCase()}` });
          const fin = await finish(made.buf, s.format);
          job.log('auditor', 'check', `shot ${s.n} beside photo ${s.photo.n}: same product, label, colours and shape; nothing added, cut off or warped`);
          const words = fp.text.filter((t) => !/unreadable/i.test(t)).map((t) => `"${t}"`).join(', ');
          const ans = parseJson<Partial<Answers>>(await see(job, 'auditor', [
            { role: 'system', content: CHECKER },
            { role: 'user', content: [
              { type: 'text', text: `The product: ${fp.product}.${words ? ` Its label text, as read from image 1: ${words}. Compare the pictures, not this list.` : ''}\nThe plan for image 2: ${sc.check}.` },
              { type: 'text', text: "Image 1, the owner's photo:" }, { type: 'image_url', image_url: { url: dataUri(s.photo.small, 'image/jpeg') } },
              { type: 'text', text: 'Image 2, the new picture:' }, { type: 'image_url', image_url: { url: dataUri(await fit(fin.buf, 1024), 'image/jpeg') } },
            ] },
          ], `check shot ${s.n} against the owner's photo`, 400, checkers, () => JSON.stringify(fx.check(s.n, s.tries))), {});
          const unchecked = QUESTIONS.some((k) => !ans[k]); // a partial answer is no answer
          // dry stand-ins are a flat colour, so the white-background measurement only counts on real pictures
          const r = unchecked ? { fails: ['the check could not be completed'], notes: [] } : verdict(ans, s.format === 'white', DRY || fin.whiteOk);
          s.error = unchecked; s.fails = r.fails; s.notes = r.notes; s.ok = !r.fails.length;
          if (s.tries === 1) { s.first = r.fails; s.firstError = unchecked; }
          if (s.ok) s.out = fin.buf;
          job.log('auditor', s.ok ? 'pass' : 'fail', `shot ${s.n}: ${s.ok ? r.notes.join('; ') || 'matches the original' : `${r.fails.join('; ')}${ans.notes ? ` (${ans.notes})` : ''}`}`);
        } catch (e: any) {
          if (e instanceof SpendRefused) stopped = "the job's spending limit was reached";
          toolError = msg(e);
          s.ok = false; s.error = true; s.fails = [`the picture could not be made (${msg(e)})`];
          if (s.tries === 1) { s.first = s.fails; s.firstError = true; }
          job.log('illustrator', 'skip', `shot ${s.n}: ${s.fails[0]}`);
        }
      };
      await Promise.all(shots.map((s) => attempt(s, false)));
      const redo = shots.filter((s) => !s.ok && s.tries === 1).slice(0, Math.max(0, MAX_IMAGE_CALLS - calls));
      await Promise.all(redo.map((s) => attempt(s, true)));
      const left = shots.filter((s) => !s.ok);
      const done = shots.filter((s) => s.ok && s.out).map((s) => ({ s, a: about(s.use, s.format, s.scene) }));
      if (!done.length) throw new Error(left.every((s) => s.error || !s.tries)
        ? `The image tool we buy from failed, so no photos were made (${stopped || toolError}). Nothing was delivered; please order again later.`
        : `None of the shots passed the check against your photo, so we are not sending any (${list([...new Set(left.flatMap((s) => s.fails))])}). A sharper, well-lit photo of the whole product usually fixes this.`);

      // 5–6. Files: the before/after sheet first, the shots, copies with their logo, and a zip
      const named = done.map((x, i) => ({ ...x, name: `shot-${i + 1}-${x.a.slug}-${FORMATS[x.s.format].size}.jpg` }));
      const logo = d?.logo ? readUpload(d.logo) : undefined;
      const withLogo: { name: string; data: Buffer }[] = [];
      if (logo) {
        try {
          const tile = await logoTile(logo);
          for (const x of named.filter((x) => (x.s.use === 'instagram' || x.s.use === 'whatsapp') && x.s.format !== 'white')) withLogo.push({ name: `with-logo/${x.name}`, data: await stamp(x.s.out!, tile, x.s.format) });
        } catch (e: any) { job.log('illustrator', 'skip', `logo copies (${msg(e)})`); }
      }
      // ready to sell: the price and WhatsApp number on the social shots, set by code so they're exactly as given
      const sell: { name: string; data: Buffer }[] = [];
      const price = d?.price ? money(d.price) : undefined;
      const phone = d?.whatsapp && e164(d.whatsapp) ? prettyPhone(d.whatsapp) : undefined;
      if (price || phone) {
        try {
          for (const x of named.filter((x) => (x.s.use === 'instagram' || x.s.use === 'whatsapp') && x.s.format !== 'white' && x.s.format !== 'wide')) sell.push({ name: `ready-to-sell-${x.name.replace(/^shot-/, '')}`, data: await sellCopy(x.s.out!, x.s.format, { price, phone, logo, business: d?.name ?? '', colour: col.brand }) });
        } catch (e: any) { job.log('illustrator', 'skip', `ready-to-sell copies (${msg(e)})`); }
      }
      job.log('illustrator', 'finish', `${named.length} shots at exact sizes, the before/after sheet${sell.length ? `, ${sell.length} ready-to-sell copies with ${[price && 'the price', phone && 'WhatsApp'].filter(Boolean).join(' and ')}` : ''}${withLogo.length ? `, ${withLogo.length} copies with their logo` : ''} and photos.zip`);
      let sheet: Buffer | undefined;
      try { sheet = await contactSheet(d?.name ?? 'Your product', photos, done); }
      catch (e: any) { job.log('illustrator', 'skip', `before/after sheet (${msg(e)})`); }
      if (sheet) job.files.push({ name: 'before-after.jpg', content: sheet });
      for (const x of named) job.files.push({ name: x.name, content: x.s.out! });
      for (const x of sell) job.files.push({ name: x.name, content: x.data });
      job.files.push({ name: 'photos.zip', content: zip([...named.map((x) => ({ name: x.name, data: x.s.out! })), ...sell, ...withLogo]) });

      // 7. For the owner
      const redone = done.filter(({ s }) => s.tries > 1 && !s.firstError);
      const unsure = named.filter((x) => x.s.notes.some((n) => /small print/.test(n))).map((x) => `shot ${named.indexOf(x) + 1}`);
      const aside = photos.filter((p) => p.why);
      const dim = usable.filter((p) => p.fp!.lit === 'no').map((p) => `photo ${p.n}`);
      const words = main.text.filter((t) => !/unreadable/i.test(t)).slice(0, 6).map((t) => `"${t}"`);
      const why = (s: Shot) => (s.tries ? list(s.fails) : stopped || 'there was no room left for it');
      const what = d?.product ? d.product.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase()) : 'product';
      job.deliverable = [
        `# Product photos: ${d?.name ?? 'your product'}`,
        `**${done.length} photo${done.length === 1 ? '' : 's'} of your ${what}, sized for where you'll use them.** Each one was made from your own photo and checked against it before we sent it. \`before-after.jpg\` shows your photo next to the new ones, and \`photos.zip\` has them all.`,
        `## Your photos`,
        ['| # | File | Use it for | Size (pixels) |', '|---|---|---|---|', ...named.map((x, i) => `| ${i + 1} | \`${x.name}\` | ${x.a.where} | ${FORMATS[x.s.format].w} × ${FORMATS[x.s.format].h} |`)].join('\n'),
        sell.length ? `**Ready to sell:** the \`ready-to-sell-…\` copies have ${[price && `your price (${price})`, phone && `your WhatsApp number (${phone})`].filter(Boolean).join(' and ')} set on them, so a customer who sees the post knows what it costs and where to order. Typed by our code, exactly as you gave it; the AI never wrote on your photos.` : `**Tip:** add your price and WhatsApp number to the order next time and we also send ready-to-sell copies with them on.`,
        withLogo.length ? `\`photos.zip\` also has a \`with-logo\` folder: the Instagram and WhatsApp photos with your logo in the corner. We placed your own logo file there; the AI never drew it.` : '',
        `**Tip:** WhatsApp shrinks photos. To send a customer a sharp one, attach it as a document instead of a photo.`,
        `## How we kept your product the same`,
        `- **We studied your photo${usable.length === 1 ? '' : 's'} first** and wrote down exactly what the product looks like: ${main.product}${words.length ? `, the words on it (${words.join(', ')})` : ''}, its colours and its shape.`,
        `- **Every shot started from your own photo**, with instructions to keep the product exactly as it is and to add no text, logos or watermarks.`,
        `- **A separate AI checker compared every shot with your photo** (not the one that made the pictures): same product? same words on the label? same colours? same shape? anything added, cut off or distorted?${done.some(({ s }) => s.format === 'white') ? ' Marketplace photos were also checked for a pure white background.' : ''} A shot had to pass every question to be sent.`,
        `- **Result:** ${done.length} of ${shots.length} shots passed.${redone.length ? ` ${redone.length === 1 ? 'One was' : `${redone.length} were`} made again with stricter instructions after the check found a problem (${list(redone.map(({ s }) => s.first.join(', ')))}), and passed the second time.` : ''}`,
        left.length ? `- **Left out:** ${left.map((s) => `${about(s.use, s.format, s.scene).title} (${why(s)})`).join('; ')}. We would rather send fewer photos than one that changes your product.` : '',
        aside.length ? `- **Not used:** ${aside.map((p) => `photo ${p.n}, because ${p.why}`).join('; ')}. A sharp photo of the whole product, in daylight, gives the best results.` : '',
        `## Before you print or post`,
        `- AI can still change very small print (ingredients, batch numbers, tiny lettering) in ways a checker can miss. Look closely at each photo before you print it or put it on packaging.`,
        unsure.length ? `- The small print on ${list(unsure)} was too small for the checker to read. Check it against your product before you use ${unsure.length === 1 ? 'that shot' : 'those shots'}.` : '',
        dim.length ? `- ${list(dim)} ${dim.length === 1 ? 'was' : 'were'} a little dark, so colours may be slightly off. Compare them with the real product.` : '',
        `- One revision is included: tell us what to fix and we make the set again, including any shot that was left out.`,
      ].filter(Boolean).join('\n\n');
      job.qa = {
        verdict: left.length ? 'revise' : 'pass',
        notes: [
          `${done.length}/${shots.length} shots passed the side-by-side check`,
          redone.length && `${redone.length} remade once (${list(redone.map(({ s }) => s.first.join(', ')))})`,
          left.length && `left out: ${left.map((s) => `shot ${s.n} (${why(s)})`).join('; ')}`,
          unsure.length && `small print not confirmed on ${list(unsure)}`,
          aside.length && `${aside.map((p) => `photo ${p.n}`).join(', ')} set aside`,
          `${calls} image calls`,
        ].filter(Boolean).join(' | '),
        model: `rules + ${[...checkers].join(' + ') || MODELS.vision}`,
      };
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
