// Editing a delivered site, by its owner, without re-running the agents. The plan, facts and photos are kept
// beside the published files (DATA_DIR/sites-src/<slug>.json, never served); an edit changes them, the engine
// re-renders the page, and every publish keeps the previous version for undo. Owners edit facts in a form
// (hours, prices, links, bank details) and the look in a few safe controls; the copy rules still apply, and
// the engine still renders every phone number, price and address from the facts.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DATA_DIR } from '../config.ts';
import { renderSite } from './engine.ts';
import { type Facts, type Item, type Notice, type Photo, parseHours } from './facts.ts';
import { validatePlan, type Plan } from './plan.ts';
import { THEMES, type ThemeId } from './themes.ts';
import { sanitizeBank, sanitizeLinks } from './links.ts';
import { prepPhoto } from './photos.ts';
import { readUpload } from '../uploads.ts';

export type SiteSource = {
  slug: string; url: string; token: string; orderId?: string; email?: string;
  plan: Plan; facts: Facts; photos: Photo[]; candidates: string[]; hidden: string[];
  createdAt: string; updatedAt: string; versions: { at: string; plan: Plan; facts: Facts; hidden: string[] }[];
};
export type SitePatch = {
  facts?: Partial<Pick<Facts, 'name' | 'offer' | 'phone' | 'whatsapp' | 'email' | 'address' | 'area' | 'city' | 'landmark' | 'hoursText' | 'delivery' | 'instagram' | 'tiktok' | 'facebook'>> & { items?: Partial<Item>[]; links?: unknown; bank?: unknown; notice?: unknown };
  plan?: { theme?: string; brand?: string; headline?: string; sub?: string; eyebrow?: string; heroPhoto?: string; gallery?: string[]; whatsappText?: string; hidden?: string[] };
};

const SRC = () => { const d = join(DATA_DIR, 'sites-src'); mkdirSync(d, { recursive: true }); return d; };
const SITE = (slug: string) => join(DATA_DIR, 'sites', slug);
const SLUG = /^[a-z0-9-]{3,60}$/;
const TOKEN = /^[A-Za-z0-9_-]{24,40}$/;

export function saveSource(s: SiteSource) { writeFileSync(join(SRC(), `${s.slug}.json`), JSON.stringify(s)); }
export function sourceBySlug(slug: string): SiteSource | undefined {
  if (!SLUG.test(slug)) return undefined;
  const f = join(SRC(), `${slug}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : undefined;
}
export function sourceByToken(token: string): SiteSource | undefined {
  if (!TOKEN.test(token)) return undefined;
  for (const f of readdirSync(SRC()).filter((x) => x.endsWith('.json'))) {
    const s = JSON.parse(readFileSync(join(SRC(), f), 'utf8')) as SiteSource;
    if (s.token === token) return s;
  }
  return undefined;
}
/** The private editor link for an order's latest site (for the delivery email only; never shown on the public order page). */
export function editLinkFor(orderId: string, base: string): string | undefined {
  const all = readdirSync(SRC()).filter((x) => x.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(SRC(), f), 'utf8')) as SiteSource).filter((s) => s.orderId === orderId);
  const last = all.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
  return last ? `${base}/edit/${last.token}` : undefined;
}
export const newEditToken = () => randomBytes(18).toString('base64url');

/** Keep a freshly delivered site's inputs so its owner can edit it later. Returns the private edit token. */
export function keepSource(input: { slug: string; url: string; plan: Plan; facts: Facts; photos: Photo[]; candidates: string[]; orderId?: string; email?: string }): string {
  const now = new Date().toISOString(), token = newEditToken();
  saveSource({ ...input, token, hidden: [], createdAt: now, updatedAt: now, versions: [] });
  return token;
}

const str = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : undefined);

/** Apply an owner's edit to a copy of the source: only known fields, cleaned, then checked by the same rules as a fresh site. */
export function applyPatch(src: SiteSource, patch: SitePatch): { plan: Plan; facts: Facts; hidden: string[]; notes: string[] } {
  const facts: Facts = structuredClone(src.facts), pf = patch.facts ?? {}, owner: string[] = [];
  for (const k of ['name', 'offer', 'phone', 'whatsapp', 'email', 'address', 'area', 'city', 'landmark', 'delivery', 'instagram', 'tiktok', 'facebook'] as const) {
    if (!(k in pf)) continue;
    const v = str((pf as any)[k], k === 'offer' || k === 'delivery' ? 200 : 120);
    (facts as any)[k] = v || undefined;
    if (v) owner.push(v);
  }
  if ('hoursText' in pf) { const t = str(pf.hoursText, 160); facts.hoursText = t || undefined; facts.hours = t ? parseHours(t) : undefined; if (t) owner.push(t); }
  if (Array.isArray(pf.items)) {
    const old = new Map(facts.items.map((i) => [i.id, i]));
    const taken = new Set(facts.items.map((i) => i.id));
    let n = 0;
    const used = new Set<string>();
    const fresh = () => { while (taken.has(`o${++n}`)); taken.add(`o${n}`); return `o${n}`; };
    facts.items = pf.items.slice(0, 120).map((it) => {
      const name = str(it.name, 80);
      if (!name) return null;
      const price = str(it.price, 24), note = str(it.note, 140), category = str(it.category, 40);
      owner.push([name, price, note, category].filter(Boolean).join(' '));
      const id = it.id && old.has(it.id) && !used.has(it.id) ? it.id : fresh();
      used.add(id);
      return { id, name, price: price || undefined, note: note || undefined, category: category || undefined, source: old.get(id)?.source ?? 'owner' } as Item;
    }).filter((x): x is Item => !!x);
  }
  if ('links' in pf) facts.links = sanitizeLinks(pf.links);
  if ('bank' in pf) facts.bank = pf.bank ? sanitizeBank(pf.bank) : undefined;
  if ('notice' in pf) { facts.notice = sanitizeNotice(pf.notice); if (facts.notice) owner.push(facts.notice.text); }
  if (owner.length) facts.sources = `${facts.sources}\n${owner.join('\n')}`; // the owner's own words are a source

  // the plan: a few safe controls; every item stays on the menu after an edit
  const plan: Plan = structuredClone(src.plan), pp = patch.plan ?? {};
  if (pp.theme && pp.theme in THEMES) plan.theme = pp.theme as ThemeId;
  if (pp.headline !== undefined) plan.hero.headline = str(pp.headline, 80) || plan.hero.headline;
  if (pp.sub !== undefined) plan.hero.sub = str(pp.sub, 200) || plan.hero.sub;
  if (pp.eyebrow !== undefined) plan.hero.eyebrow = str(pp.eyebrow, 60) || undefined;
  if (pp.heroPhoto === '') { plan.hero.photo = undefined; plan.hero.variant = 'type'; }
  else if (pp.heroPhoto && src.photos.some((p) => p.id === pp.heroPhoto && p.kind !== 'flyer' && p.kind !== 'logo')) { plan.hero.photo = pp.heroPhoto; if (plan.hero.variant === 'type') plan.hero.variant = 'split'; }
  if (Array.isArray(pp.gallery)) {
    const ids = pp.gallery.filter((id) => typeof id === 'string' && src.photos.some((p) => p.id === id && p.kind !== 'flyer' && p.kind !== 'logo')).slice(0, 8);
    const g = plan.sections.find((x) => x.kind === 'gallery');
    if (g && g.kind === 'gallery') g.photos = ids;
    else if (ids.length >= 3) plan.sections.splice(Math.max(0, plan.sections.findIndex((x) => x.kind === 'location' || x.kind === 'cta')), 0, { kind: 'gallery', variant: 'grid', title: 'Gallery', photos: ids });
  }
  if (pp.whatsappText !== undefined) plan.whatsappText = str(pp.whatsappText, 140) || plan.whatsappText;
  if (Array.isArray(pf.items)) for (const s of plan.sections) if (s.kind === 'offer') {
    const desc = new Map(s.items.map((x) => [x.id, x]));
    s.items = facts.items.map((i) => ({ id: i.id, desc: desc.get(i.id)?.desc, photo: desc.get(i.id)?.photo }));
  }
  const hidden = Array.isArray(pp.hidden) ? pp.hidden.filter((k) => typeof k === 'string' && plan.sections.some((s) => s.kind === k) && k !== 'cta').slice(0, 10) : src.hidden;
  const checked = validatePlan(plan, facts, src.photos, src.candidates);
  if (pp.brand && /^#[0-9a-fA-F]{6}$/.test(pp.brand)) checked.plan.brand = pp.brand.toUpperCase(); // the owner may pick any colour
  else checked.plan.brand = plan.brand;
  return { plan: checked.plan, facts, hidden, notes: checked.notes };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The announcement bar: one line of the owner's text, optional dates (from ≤ until), closed or not, and where its link goes. */
export function sanitizeNotice(raw: any): Notice | undefined {
  const text = str(raw?.text, 140);
  if (!text) return undefined;
  let from = DAY.test(raw?.from ?? '') ? raw.from : undefined, until = DAY.test(raw?.until ?? '') ? raw.until : undefined;
  if (from && until && until < from) [from, until] = [until, from];
  return { text, ...(from ? { from } : {}), ...(until ? { until } : {}), ...(raw?.closed ? { closed: true } : {}), ...(raw?.link === 'whatsapp' || raw?.link === 'order' ? { link: raw.link } : {}) };
}

const visible = (plan: Plan, hidden: string[]): Plan => ({ ...plan, sections: plan.sections.filter((s) => !hidden.includes(s.kind)) });

/** The page as it would look with this edit, for the editor's preview (photos resolve under the live site). */
export function previewHtml(src: SiteSource, patch: SitePatch): string {
  const { plan, facts, hidden } = applyPatch(src, patch);
  return renderSite(visible(plan, hidden), facts, src.photos, { url: src.url }).html.replace(/<head([^>]*)>/i, `<head$1><base href="/s/${src.slug}/" target="_blank">`);
}

function write(src: SiteSource) {
  const r = renderSite(visible(src.plan, src.hidden), src.facts, src.photos, { url: src.url });
  const dir = SITE(src.slug);
  mkdirSync(dir, { recursive: true }); // photos stay; only the page and the files about it are rewritten
  writeFileSync(join(dir, 'index.html'), r.html);
  writeFileSync(join(dir, 'llms.txt'), r.llms);
  writeFileSync(join(dir, 'robots.txt'), r.robots);
}

/** Publish an edit: the previous version is kept (last 10) and the live page is rewritten. */
export function publishPatch(src: SiteSource, patch: SitePatch): SiteSource {
  const { plan, facts, hidden } = applyPatch(src, patch);
  const next: SiteSource = { ...src, plan, facts, hidden, updatedAt: new Date().toISOString(), versions: [...src.versions, { at: src.updatedAt, plan: src.plan, facts: src.facts, hidden: src.hidden }].slice(-10) };
  write(next); saveSource(next);
  return next;
}

export function undoLast(src: SiteSource): SiteSource {
  const prev = src.versions.at(-1);
  if (!prev) throw new Error('Nothing to undo yet.');
  const next: SiteSource = { ...src, plan: prev.plan, facts: prev.facts, hidden: prev.hidden, updatedAt: new Date().toISOString(), versions: src.versions.slice(0, -1) };
  write(next); saveSource(next);
  return next;
}

/** Add an owner's photo (an /api/uploads id, already re-encoded there) to the site's photo set, sized like the site's own. */
export async function addPhoto(src: SiteSource, uploadId: string, caption?: string): Promise<Photo> {
  const buf = readUpload(uploadId);
  if (!buf) throw new Error('That upload has expired. Choose the photo again.');
  if (src.photos.length >= 40) throw new Error('This site already has 40 photos. Remove one in a revision first.');
  const p = await prepPhoto(buf, 1800);
  const n = src.photos.length + 1, file = `own-${n}-${randomBytes(3).toString('hex')}.jpg`;
  mkdirSync(SITE(src.slug), { recursive: true });
  writeFileSync(join(SITE(src.slug), file), p.buf);
  const photo: Photo = { id: `own${n}`, file, w: p.w, h: p.h, kind: 'other', subject: str(caption, 80) || src.facts.name, quality: 4 };
  src.photos.push(photo); saveSource(src);
  return photo;
}

/** What the editor shows: the editable facts and look, never the token or the version history itself. */
export function editorView(src: SiteSource) {
  const f = src.facts;
  return {
    slug: src.slug, url: src.url, updatedAt: src.updatedAt, canUndo: src.versions.length > 0,
    facts: { name: f.name, offer: f.offer, phone: f.phone, whatsapp: f.whatsapp, email: f.email, address: f.address, area: f.area, city: f.city, landmark: f.landmark, hoursText: f.hoursText, delivery: f.delivery, instagram: f.instagram, tiktok: f.tiktok, facebook: f.facebook, items: f.items.map((i) => ({ id: i.id, name: i.name, price: i.price, note: i.note, category: i.category })), links: f.links ?? {}, bank: f.bank ?? null, notice: f.notice ?? null, kind: f.kind },
    plan: { theme: src.plan.theme, brand: src.plan.brand, headline: src.plan.hero.headline, sub: src.plan.hero.sub, eyebrow: src.plan.hero.eyebrow, heroPhoto: src.plan.hero.photo, gallery: (src.plan.sections.find((x) => x.kind === 'gallery') as { photos?: string[] } | undefined)?.photos ?? [], whatsappText: src.plan.whatsappText, sections: src.plan.sections.map((s) => s.kind), hidden: src.hidden },
    photos: src.photos.filter((p) => p.kind !== 'flyer').map((p) => ({ id: p.id, file: p.file, subject: p.subject })),
    themes: Object.values(THEMES).map((t) => ({ id: t.id, mood: t.mood })),
  };
}
