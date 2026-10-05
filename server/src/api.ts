// Syncly API: quotes, orders, live job progress (SSE), the public books.
//   PORT=8790 node src/api.ts          (OUTLAY_DRY=1 for demo mode: no money moves, clearly labelled)
import { createOnrampServerKit, KitError as OnrampKitError } from '@circle-fin/onramp-kit/server';
import { getAddress, isAddress, keccak256, toBytes } from 'viem';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { DATA_DIR, DRY } from './config.ts';
import { account, hasSeed } from './wallets.ts';
import { bus, type SynclyEvent } from './bus.ts';
import { CATALOG, findService } from './services/index.ts';
import { cleanDetails, detailsBrief, type BusinessDetails } from './details.ts';
import { MAX_BYTES, allowUpload, readUpload, saveUpload } from './uploads.ts';
import { addPhoto, applyPatch, editorView, previewHtml, publishPatch, sourceByToken, undoLast, type SiteSource } from './site/edit.ts';
import { LINKS, chowdeckHours, readChowdeck, samePhone } from './site/links.ts';
import { FORMATS, countScan, posterHtml, posterTargets, scanStats, type PosterOpts } from './site/poster.ts';
import { renderPoster } from './browser.ts';
import { autoAcceptDue, createQuote, decide, escrowPending, getOrder, noteForRevision, openEscrow, readJob, replay, resumeInterrupted, retry, start, syncEscrow } from './orders.ts';
import { escrowConfig, refreshBondFree } from './escrow.ts';
import { MODE as CFO_MODE, POLICY as CFO_POLICY, freshSnapshot, reclaimSurplus, startTreasury, teamShortfall, tick as cfoTick } from './cfo/treasury.ts';
import { decisions as cfoDecisions, verifyLog } from './cfo/log.ts';
import { tractionReport } from './traction.ts';
import { approveBill, booksCsv, cancelDoc, confirmBusiness, createBill, createInvoice, desk, getDoc, payConfig, payTick, payWatchlist, publicDoc, registerBusiness, reportFor, syncPaid } from './pay.ts';
import { vendorPayees } from './payees.ts';
import { screeningStatus, startScreening } from './screen.ts';
import { books, beancount, team } from './books.ts';
import { resolveSettlements } from './settle.ts';
import { MAILER, MAIL_FROM, resend } from './mail.ts';

process.env.OUTLAY_QUIET ??= '1';

// First boot on a fresh volume (Railway): restore the live books from OUTLAY_BOOTSTRAP, a base64 gzip
// of { "orders/<id>.json" | "jobs/<job>/<file>": contents }. Skipped once any order exists.
function bootstrap() {
  const b64 = process.env.OUTLAY_BOOTSTRAP?.trim();
  if (!b64 || existsSync(join(DATA_DIR, 'orders'))) return;
  const files: Record<string, string> = JSON.parse(gunzipSync(Buffer.from(b64, 'base64')).toString('utf8'));
  let n = 0;
  for (const [rel, body] of Object.entries(files)) {
    if (!/^(orders|jobs\/job_\w+)\/[\w-]+\.(json|md|csv)$/.test(rel)) continue;
    mkdirSync(dirname(join(DATA_DIR, rel)), { recursive: true });
    writeFileSync(join(DATA_DIR, rel), body);
    n++;
  }
  console.log(`restored ${n} files into ${DATA_DIR}`);
}
bootstrap();

const app = new Hono();

// The books are private. The owner's key (OUTLAY_OWNER_KEY, set in Railway) opens them, sent as x-owner-key.
const OWNER_KEY = process.env.OUTLAY_OWNER_KEY?.trim() ?? '';
function isOwner(c: any): boolean {
  const got = String(c.req.header('x-owner-key') ?? '');
  return OWNER_KEY.length >= 8 && got.length === OWNER_KEY.length && timingSafeEqual(Buffer.from(got), Buffer.from(OWNER_KEY));
}
// Everyone else sees the work, the sellers and the Arc transactions, never what a tool cost us.
const COST_KEYS = new Set(['usd', 'spentUsd', 'expectUsd', 'maxUsd', 'estCostUsd', 'expectedProfitUsd', 'budgetUsd', 'listedCostUsd']);
const COST_REASON = /tool cost|E\[profit\]|promo covers|promo left|promo budget/;
function scrub<T>(x: T): T {
  if (Array.isArray(x)) return x.map(scrub) as T;
  if (!x || typeof x !== 'object') return x;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(x)) {
    if (COST_KEYS.has(k)) continue;
    out[k] = k === 'reasons' && Array.isArray(v) ? v.filter((r) => !COST_REASON.test(String(r))) : scrub(v);
  }
  return out as T;
}
const shown = <T>(c: any, x: T): T => (isOwner(c) ? x : scrub(x));

/** The treasury's public address proves which seed is loaded without revealing it. */
function treasury() {
  try { return hasSeed() ? account('treasury').address : null; } catch { return 'invalid seed'; }
}
app.get('/api/health', (c) => c.json({ ok: true, mode: DRY ? 'demo' : 'live', keys: DRY || hasSeed(), treasury: treasury(), mail: MAILER ?? 'off' }));
app.get('/api/services', (c) => c.json({ mode: DRY ? 'demo' : 'live', services: shown(c, CATALOG) }));
// The owner can send themselves a test email from the private books page.
app.post('/api/owner/test-email', async (c) => {
  if (!isOwner(c)) return c.json({ error: 'owner only' }, 401);
  const to = String((await c.req.json().catch(() => ({})))?.to ?? '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return c.json({ error: 'Enter a valid email address.' }, 400);
  if (MAILER !== 'resend') return c.json({ error: `Email goes through ${MAILER ?? 'nothing'} right now, not Resend: set RESEND_API_KEY in Railway.` }, 400);
  try {
    const r = await resend({ to, subject: 'Syncly test email', text: `This is a test from Syncly, sent from ${MAIL_FROM}. Deliveries reach customers the same way.`, html: `<p>This is a test from <b>Syncly</b>, sent from ${MAIL_FROM.replace(/</g, '&lt;')}.</p><p>Deliveries reach customers the same way.</p>` });
    return c.json({ ok: true, id: r.id });
  } catch (e: any) { return c.json({ error: e.message }, 502); }
});
app.get('/api/owner', (c) => (isOwner(c) ? c.json({ ok: true }) : c.json({ error: 'That key doesn\'t open the books.' }, 401)));
app.get('/api/escrow', (c) => c.json(escrowConfig()));

app.post('/api/quote', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const service = String(b.service ?? ''), email = String(b.email ?? '');
  let brief = String(b.brief ?? '');
  let details: BusinessDetails | undefined;
  if (b.details) {
    try { details = cleanDetails(b.details, service); } catch (e: any) { return c.json({ error: e.message }, 400); }
    brief = `${detailsBrief(details, service)}${brief.trim() ? `\n\n${brief.trim()}` : ''}`;
  }
  if (brief.trim().length < 12) return c.json({ error: 'Tell us a bit more: at least a sentence.' }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return c.json({ error: 'A valid email is needed so we can deliver.' }, 400);
  try {
    const unfunded = await teamShortfall(service);
    if (unfunded) return c.json({ error: unfunded }, 409);
    return c.json(shown(c, createQuote({ service, brief, email, details })));
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});

// Photos and logos for an order: re-encoded on our server (which strips camera metadata) before storing.
app.post('/api/uploads', async (c) => {
  const who = c.req.header('x-forwarded-for')?.split(',')[0].trim() || 'local';
  const body = await c.req.parseBody({ all: true }).catch(() => ({} as Record<string, unknown>));
  const files = ([] as unknown[]).concat(body.file ?? []).filter((f): f is File => typeof f === 'object' && f !== null && 'arrayBuffer' in (f as object)).slice(0, 8);
  if (!files.length) return c.json({ error: 'No image received.' }, 400);
  if (!allowUpload(who, files.length)) return c.json({ error: 'Too many uploads from here in the last hour. Try again later.' }, 429);
  const out = [];
  for (const f of files) {
    if (f.size > MAX_BYTES) return c.json({ error: `${f.name} is over 12 MB.` }, 400);
    try { out.push(await saveUpload(Buffer.from(await f.arrayBuffer()))); } catch (e: any) { return c.json({ error: `${f.name}: ${e.message}` }, 400); }
  }
  return c.json({ uploads: out });
});
app.get('/api/uploads/:id', (c) => {
  const buf = readUpload(c.req.param('id'));
  if (!buf) return c.text('not found', 404);
  c.header('content-type', 'image/jpeg');
  c.header('cache-control', 'public, max-age=31536000, immutable');
  c.header('x-content-type-options', 'nosniff');
  return c.body(buf);
});

/** The public shape of an order: runs expanded, email masked, live job progress attached. */
function view(id: string) {
  const o = getOrder(id)!;
  const runs = o.runs.map((r) => readJob(r)).filter(Boolean);
  return { ...o, email: o.email.replace(/^(.).*(@.*)$/, '$1•••$2'), runs, live: liveJobs.get(o.id) ?? null, team: [...(findService(o.service)?.team ?? [])] };
}

app.post('/api/orders/:id/start', async (c) => {
  const o = getOrder(c.req.param('id'));
  if (!o) return c.json({ error: 'not found' }, 404);
  if (!DRY && !hasSeed()) return c.json({ error: 'The team is still clocking in. Try again in a few minutes.' }, 503);
  const { mode } = await c.req.json().catch(() => ({ mode: 'promo' }));
  try {
    await start(o, mode === 'simulated' ? 'simulated' : 'promo');
    return c.json(shown(c, view(o.id)));
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});

// Paid jobs: the CFO opens the escrow for the customer's wallet; the browser then approves and funds it.
app.post('/api/orders/:id/escrow', async (c) => {
  const o = getOrder(c.req.param('id'));
  if (!o) return c.json({ error: 'not found' }, 404);
  if (!DRY && !hasSeed()) return c.json({ error: 'The team is still clocking in. Try again in a few minutes.' }, 503);
  const { customer } = await c.req.json().catch(() => ({}));
  try {
    await openEscrow(o.id, String(customer ?? ''));
    return c.json(shown(c, view(o.id)));
  } catch (e: any) {
    console.error(`escrow open ${o.id}: ${e.shortMessage ?? e.message}`);
    return c.json({ error: e.shortMessage ?? e.message }, 400);
  }
});

// After the customer's wallet acts on the escrow (fund, accept, revise, reject), read the chain and follow it.
// A revision note is sent first, with the email on the order, because the chain only records the request.
app.post('/api/orders/:id/sync', async (c) => {
  const o = getOrder(c.req.param('id'));
  if (!o?.escrow) return c.json({ error: 'not found' }, 404);
  const { tx, note, email } = await c.req.json().catch(() => ({}));
  try {
    if (note) noteForRevision(o, String(email ?? ''), String(note));
    await syncEscrow(o.id, tx ? String(tx) : undefined);
    return c.json(shown(c, view(o.id)));
  } catch (e: any) {
    return c.json({ error: e.shortMessage ?? e.message }, 400);
  }
});

app.post('/api/orders/:id/retry', async (c) => {
  const o = getOrder(c.req.param('id'));
  if (!o) return c.json({ error: 'not found' }, 404);
  const { email } = await c.req.json().catch(() => ({}));
  if (String(email ?? '').trim().toLowerCase() !== o.email) return c.json({ error: 'Only the customer who placed this order can retry it.' }, 403);
  try {
    retry(o);
    return c.json(shown(c, view(o.id)));
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});

app.post('/api/orders/:id/:action{accept|reject|revise}', async (c) => {
  const o = getOrder(c.req.param('id'));
  if (!o) return c.json({ error: 'not found' }, 404);
  const { note, email } = await c.req.json().catch(() => ({}));
  // Only the customer decides. Until wallet signatures land, the email on the order is the key.
  if (String(email ?? '').trim().toLowerCase() !== o.email) return c.json({ error: 'Only the customer who placed this order can decide on it.' }, 403);
  try {
    decide(o, c.req.param('action') as 'accept' | 'reject' | 'revise', note);
    return c.json(shown(c, view(o.id)));
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});

app.get('/api/orders/:id', (c) => {
  const o = getOrder(c.req.param('id'));
  if (!o) return c.json({ error: 'not found' }, 404);
  return c.json(shown(c, view(o.id)));
});

const MEDIA: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', svg: 'image/svg+xml', zip: 'application/zip', pdf: 'application/pdf', html: 'text/plain; charset=utf-8' };
app.get('/api/orders/:id/files/:name', (c) => {
  const o = getOrder(c.req.param('id'));
  const name = c.req.param('name');
  if (!o || !/^[a-z0-9._-]+$/i.test(name)) return c.text('not found', 404);
  if (name === 'job.json' && !isOwner(c)) return c.text('not found', 404); // the job record holds our costs
  const last = o.runs[o.runs.length - 1];
  const f = last && join(DATA_DIR, 'jobs', last, name);
  if (!f || !existsSync(f)) return c.text('not found', 404);
  const ext = name.split('.').pop()!.toLowerCase();
  const media = MEDIA[ext];
  c.header('content-type', media ?? (ext === 'csv' ? 'text/csv' : 'text/markdown'));
  // Pictures and video open in the browser; data files download.
  c.header('content-disposition', `${media && ext !== 'pdf' && c.req.query('download') === undefined ? 'inline' : 'attachment'}; filename="${o.id}-${name}"`); // a PDF can't open inside the sandbox
  if (media) c.header('cache-control', 'public, max-age=86400');
  // Generated files never run as our site: no scripts, no same-origin access.
  c.header('content-security-policy', "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'");
  c.header('x-content-type-options', 'nosniff');
  return c.body(readFileSync(f));
});

// Customer sites built by the web designer: static files, isolated from our own origin by a CSP sandbox.
const SITE_MIME: Record<string, string> = { html: 'text/html; charset=utf-8', css: 'text/css', js: 'text/javascript', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon', txt: 'text/plain', xml: 'application/xml' };
// A hand-finished file in server/sites/<slug>/ wins over what the designer generated; the rest still comes from the volume.
const SITE_FINISHED = fileURLToPath(new URL('../sites/', import.meta.url));
const site = (c: any) => {
  const slug = c.req.param('slug'), file = c.req.param('file') || 'index.html';
  if (!/^[a-z0-9-]{3,60}$/.test(slug) || !/^[a-z0-9._-]{1,80}$/i.test(file)) return c.text('not found', 404);
  const own = join(SITE_FINISHED, slug, file);
  const f = existsSync(own) ? own : join(DATA_DIR, 'sites', slug, file);
  if (!existsSync(f)) return c.text('not found', 404);
  c.header('content-type', SITE_MIME[file.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream');
  c.header('content-security-policy', "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox; default-src * data: blob: 'unsafe-inline'");
  c.header('x-content-type-options', 'nosniff');
  c.header('cache-control', 'public, max-age=300');
  // Relative asset paths must resolve under the site whether or not the URL has a trailing slash.
  if (file === 'index.html' && c.req.query('src') === 'qr') countScan(slug); // a scan of the shop's QR poster
  if (f.endsWith('.html')) return c.body(readFileSync(f, 'utf8').replace(/<head([^>]*)>/i, `<head$1><base href="/s/${slug}/">`));
  return c.body(readFileSync(f));
};
app.get('/s/:slug', site);
app.get('/s/:slug/', site);
app.get('/s/:slug/:file', site);

// The owner's site editor, behind the private link in their delivery email: edit the facts (prices, hours, menu,
// ordering and payment links, bank details) and the look, preview, publish, undo. Pages are re-rendered by the engine.
const editHits = new Map<string, number[]>();
const editAllowed = (c: any, kind: string, max: number) => {
  const who = `${kind}:${c.req.header('x-forwarded-for')?.split(',')[0].trim() || 'local'}`, now = Date.now();
  const hits = (editHits.get(who) ?? []).filter((t) => now - t < 3600_000);
  if (hits.length >= max) return false;
  editHits.set(who, [...hits, now]);
  return true;
};
const editable = (c: any) => {
  const src = sourceByToken(c.req.param('token'));
  if (!src) return c.json({ error: 'This edit link is not valid. Use the link in your delivery email.' }, 404) as Response;
  if (existsSync(join(SITE_FINISHED, src.slug, 'index.html'))) return c.json({ error: 'This site was finished by hand, so it can only be changed by asking us. Reply to your delivery email.' }, 409) as Response;
  return src;
};
app.get('/api/site-edit/:token', (c) => {
  if (!editAllowed(c, 'get', 120)) return c.json({ error: 'Too many requests from here in the last hour. Try again later.' }, 429);
  const src = editable(c);
  return src instanceof Response ? src : c.json({ ...editorView(src), scans: scanStats(src.slug), integrations: Object.entries(LINKS).map(([id, d]) => ({ id, label: d.label, group: d.group, hint: d.hint })) });
});
app.post('/api/site-edit/:token/preview', async (c) => {
  if (!editAllowed(c, 'preview', 600)) return c.json({ error: 'Too many previews from here in the last hour. Try again later.' }, 429);
  const src = editable(c);
  if (src instanceof Response) return src;
  try { const patch = await c.req.json(); return c.json({ html: previewHtml(src, patch), notes: applyPatch(src, patch).notes }); } catch (e) { return fail(c, e); }
});
app.post('/api/site-edit/:token/publish', async (c) => {
  if (!editAllowed(c, 'publish', 40)) return c.json({ error: 'Too many changes from here in the last hour. Try again later.' }, 429);
  const src = editable(c);
  if (src instanceof Response) return src;
  try { const next = publishPatch(src, await c.req.json()); return c.json(editorView(next)); } catch (e) { return fail(c, e); }
});
app.post('/api/site-edit/:token/undo', (c) => {
  if (!editAllowed(c, 'publish', 40)) return c.json({ error: 'Too many changes from here in the last hour. Try again later.' }, 429);
  const src = editable(c);
  if (src instanceof Response) return src;
  try { return c.json(editorView(undoLast(src))); } catch (e) { return fail(c, e); }
});
app.post('/api/site-edit/:token/photo', async (c) => {
  if (!editAllowed(c, 'photo', 30)) return c.json({ error: 'Too many photos from here in the last hour. Try again later.' }, 429);
  const src = editable(c);
  if (src instanceof Response) return src;
  const b = await c.req.json().catch(() => ({} as any));
  try { const p = await addPhoto(src, String(b.upload ?? ''), b.caption); return c.json({ id: p.id, file: p.file, subject: p.subject }); } catch (e) { return fail(c, e); }
});
// Bring a Chowdeck store's menu and hours into the editor (the owner still reviews and publishes). When the store's
// phone differs from the site's, the editor asks before importing, so a wrong link doesn't fill the site with another menu.
app.post('/api/site-edit/:token/chowdeck', async (c) => {
  if (!editAllowed(c, 'chowdeck', 12)) return c.json({ error: 'Too many imports from here in the last hour. Try again later.' }, 429);
  const src = editable(c);
  if (src instanceof Response) return src;
  const b = await c.req.json().catch(() => ({} as any));
  try {
    const store = await readChowdeck(String(b.url ?? ''));
    const phones = [src.facts.phone, src.facts.whatsapp, b.phone].filter(Boolean) as string[];
    const matches = !store.phone || phones.some((p) => samePhone(p, store.phone));
    return c.json({ url: store.url, name: store.name, phone: store.phone, phoneMatches: matches, items: store.items, hoursText: chowdeckHours(store) });
  } catch (e) { return fail(c, e); }
});
// QR posters for the shop (site/poster.ts): a preview page, and the print PDF or PNG from our headless Chrome.
// Unpublished edits in the editor ride along as `patch`, so the poster matches what the owner sees.
const posterSite = (src: SiteSource, b: any) => { if (!b?.patch) return src; const { plan, facts } = applyPatch(src, b.patch); return { ...src, plan, facts }; };
app.post('/api/site-edit/:token/poster', async (c) => {
  if (!editAllowed(c, 'poster', 400)) return c.json({ error: 'Too many previews from here in the last hour. Try again later.' }, 429);
  const src = editable(c);
  if (src instanceof Response) return src;
  const b = await c.req.json().catch(() => ({} as any));
  try {
    const site = posterSite(src, b), p = await posterHtml(site, b as PosterOpts, true);
    return c.json({ html: p.html, format: p.format, target: p.target, targets: posterTargets(site).map(({ id, label, headline, sub }) => ({ id, label, headline, sub })), formats: Object.entries(FORMATS).map(([id, f]) => ({ id, label: f.label, print: f.print })), scans: scanStats(src.slug) });
  } catch (e) { return fail(c, e); }
});
app.post('/api/site-edit/:token/poster/file', async (c) => {
  if (!editAllowed(c, 'poster-file', 20)) return c.json({ error: 'Too many downloads from here in the last hour. Try again later.' }, 429);
  const src = editable(c);
  if (src instanceof Response) return src;
  const b = await c.req.json().catch(() => ({} as any));
  try {
    const kind = b.kind === 'png' ? 'png' : 'pdf';
    const p = await posterHtml(posterSite(src, b), b as PosterOpts);
    const buf = await renderPoster(p.html, p.w, p.h, kind, p.format === 'status' ? 1 : 3);
    c.header('content-type', kind === 'pdf' ? 'application/pdf' : 'image/png');
    c.header('content-disposition', `attachment; filename="${src.slug}-qr-${p.format}.${kind}"`);
    return c.body(new Uint8Array(buf));
  } catch (e) { return fail(c, e); }
});

// ---------------------------------------------------------------- Syncly Pay: a business's invoices and bills, booked on Arc
const payHits = new Map<string, number[]>();
const payAllowed = (c: any, max = 12) => {
  const who = c.req.header('x-forwarded-for')?.split(',')[0].trim() || 'local', now = Date.now();
  const hits = (payHits.get(who) ?? []).filter((t) => now - t < 3600_000);
  if (hits.length >= max) return false;
  payHits.set(who, [...hits, now]);
  return true;
};
const fail = (c: any, e: any, code = 400) => c.json({ error: String(e?.message ?? e).split('\n')[0] }, code);
app.get('/api/pay/config', (c) => c.json(payConfig()));

// Arc Onramp (Circle's Onramp Kit; Transak processes the payment): buy USDC on Arc with Apple Pay, Google Pay,
// a debit card or a bank transfer, for eligible users in the US, UK and EU for now. The API key stays here; the
// browser gets a short-lived session that can only deliver USDC on Arc to the wallet it was minted for.
const onramp = process.env.ONRAMP_API_KEY?.trim() ? createOnrampServerKit({ apiKey: process.env.ONRAMP_API_KEY.trim(), referrerDomain: process.env.ONRAMP_REFERRER_DOMAIN?.trim() || 'hiresyncly.site' }) : null;
app.get('/api/onramp/config', (c) => c.json({ enabled: !!onramp, regions: 'US, UK and EU', methods: ['Apple Pay', 'Google Pay', 'Debit card', 'Bank transfer'] }));
app.post('/api/onramp/sessions', async (c) => {
  if (!onramp) return c.json({ error: 'Buying with a card is not switched on yet.' }, 503);
  if (!payAllowed(c, 10)) return c.json({ error: 'Too many requests from here in the last hour. Try again later.' }, 429);
  const body = await c.req.json().catch(() => ({} as any));
  const to = String(body?.destinationAddress ?? '');
  if (!isAddress(to)) return c.json({ error: 'Connect your wallet first, so the USDC knows where to go.' }, 400);
  try {
    const session = await onramp.createSession({
      appUserId: 'w_' + keccak256(toBytes(to.toLowerCase())).slice(2, 26), // stable per wallet, no personal data
      destinationAddress: getAddress(to), destinationChain: 'Arc',
      assets: { pairs: [{ token: 'USDC', chain: 'arc' }] },
      metadata: { app: 'syncly', page: String(body?.page ?? '').slice(0, 40) },
    });
    return c.json(session);
  } catch (e: any) {
    const status = e instanceof OnrampKitError ? ({ INPUT: 400, RATE_LIMIT: 429, NETWORK: 504, SERVICE: 502, RPC: 502 } as Record<string, number>)[e.type] ?? 500 : 500;
    console.error(`onramp session: ${e?.message ?? e}`);
    return c.json({ error: status === 400 ? 'The card checkout could not start for this wallet.' : 'The card checkout is unavailable right now. Try again in a minute.' }, status as any);
  }
});
app.post('/api/pay/invoices', async (c) => {
  if (!payAllowed(c)) return c.json({ error: 'Too many invoices from here in the last hour. Try again later.' }, 429);
  try { const r = await createInvoice(await c.req.json()); return c.json({ ...r, doc: publicDoc(r.doc) }); } catch (e) { return fail(c, e); }
});
app.get('/api/pay/invoices/:id', (c) => { const d = getDoc(c.req.param('id')); return d ? c.json(publicDoc(d)) : c.json({ error: 'No such invoice.' }, 404); });
app.post('/api/pay/invoices/:id/sync', async (c) => {
  const d = getDoc(c.req.param('id'));
  if (!d) return c.json({ error: 'No such invoice.' }, 404);
  const body = await c.req.json().catch(() => ({} as any));
  try { await syncPaid(d, { tx: body.tx, demoPayer: DRY && body.demoPayer ? String(body.demoPayer) : undefined }); return c.json(publicDoc(getDoc(d.id)!)); } catch (e) { return fail(c, e); }
});
app.post('/api/pay/business', async (c) => {
  if (!payAllowed(c, 6)) return c.json({ error: 'Too many requests from here in the last hour. Try again later.' }, 429);
  try { return c.json(await registerBusiness(await c.req.json())); } catch (e) { return fail(c, e); }
});
app.post('/api/pay/confirm', async (c) => { const b = await c.req.json().catch(() => ({} as any)); try { return c.json(await confirmBusiness(String(b.b ?? ''), String(b.c ?? ''))); } catch (e) { return fail(c, e); } });
app.get('/api/pay/desk/:token', async (c) => { try { return c.json(await desk(c.req.param('token'))); } catch (e) { return fail(c, e, 404); } });
app.get('/api/pay/desk/:token/report', async (c) => { try { return c.json(await reportFor(c.req.param('token'))); } catch (e) { return fail(c, e, 404); } });
app.post('/api/pay/desk/:token/report', async (c) => {
  if (!payAllowed(c, 6)) return c.json({ error: 'Too many requests from here in the last hour. Try again later.' }, 429);
  try { return c.json(await reportFor(c.req.param('token'), true)); } catch (e) { return fail(c, e); }
});
app.get('/api/pay/desk/:token/books.csv', async (c) => {
  try { const csv = await booksCsv(c.req.param('token')); c.header('content-type', 'text/csv; charset=utf-8'); c.header('content-disposition', 'attachment; filename="syncly-pay-books.csv"'); return c.body(csv); } catch (e) { return fail(c, e, 404); }
});
app.post('/api/pay/bills', async (c) => {
  if (!payAllowed(c, 20)) return c.json({ error: 'Too many bills from here in the last hour. Try again later.' }, 429);
  try { return c.json(publicDoc(await createBill(await c.req.json()))); } catch (e) { return fail(c, e); }
});
app.post('/api/pay/bills/:id/approve', async (c) => { try { return c.json(publicDoc(await approveBill(c.req.param('id'), await c.req.json()))); } catch (e) { return fail(c, e); } });
app.post('/api/pay/docs/:id/cancel', async (c) => { const b = await c.req.json().catch(() => ({} as any)); try { return c.json(publicDoc(cancelDoc(c.req.param('id'), String(b.token ?? '')))); } catch (e) { return fail(c, e); } });
setInterval(() => void payTick(), 60_000);

app.get('/api/books', async (c) => (isOwner(c) ? c.json(await books()) : c.json({ error: 'owner only' }, 401)));
// What anyone can see: how much work the team has done, without any money figures.
app.get('/api/stats', async (c) => {
  const b = await books();
  return c.json({ mode: b.mode, toolCalls: b.counters.toolCalls, settled: b.ledger.filter((e: any) => e.meta?.kind === 'tool' && e.meta?.settled).length, delivered: b.counters.delivered, customers: b.counters.customers });
});

// The CFO in public: what it sees, the rules it follows, and every decision it made (signed, hash-chained).
let verified: { at: number; v: Awaited<ReturnType<typeof verifyLog>> } | null = null;
// After the Boss changes the vault's limits from the Books page: the CFO re-plans now instead of at its next tick.
const nudges: number[] = [];
app.post('/api/cfo/nudge', (c) => {
  const now = Date.now();
  while (nudges.length && now - nudges[0] > 3600_000) nudges.shift();
  if (nudges.length >= 12) return c.json({ ok: false }, 429);
  nudges.push(now);
  void cfoTick('the Boss changed the vault limits');
  return c.json({ ok: true });
});
// The Boss sends what agents hold beyond their need back to the vault (owner only: it moves real money).
app.post('/api/cfo/reclaim', async (c) => {
  if (!isOwner(c)) return c.json({ error: 'owner only' }, 401);
  try { return c.json({ returned: await reclaimSurplus() }); } catch (e: any) { return c.json({ error: String(e?.message ?? e).split('\n')[0] }, 400); }
});
app.get('/api/cfo', async (c) => {
  if (!verified || Date.now() - verified.at > 60_000) verified = { at: Date.now(), v: await verifyLog() };
  const log = cfoDecisions(150);
  const count = (st: string) => log.filter((d) => d.status === st).length;
  const s = await freshSnapshot();
  const planFile = join(DATA_DIR, 'cfo', 'epoch.json');
  return c.json({
    enabled: escrowConfig().enabled, mode: CFO_MODE, policy: CFO_POLICY, snapshot: s, verify: verified.v,
    plan: existsSync(planFile) ? JSON.parse(readFileSync(planFile, 'utf8')) : null,
    metrics: { done: count('done'), escalated: count('escalated'), refused: count('refused'), wouldDo: count('would-do'), proposed: s?.proposals.total ?? 0, cosigned: s?.proposals.cosigned ?? 0 },
    screening: screeningStatus(),
    decisions: log,
  });
});
app.get('/api/team', (c) => c.json(shown(c, team())));
app.get('/api/replay', (c) => c.json({ mode: DRY ? 'demo' : 'live', orders: shown(c, replay(Number(c.req.query('limit') ?? 6), c.req.query('order') || undefined)) }));
// Public: counts and Arc transactions. With the owner's key: the money figures too.
app.get('/api/traction.md', (c) => {
  if (DRY) return c.text('Traction is only reported from live books.', 404);
  c.header('content-type', 'text/markdown; charset=utf-8');
  return c.body(tractionReport({ money: isOwner(c) }).md);
});
app.get('/api/traction', (c) => (isOwner(c) ? c.json(DRY ? null : tractionReport({ money: true }).summary) : c.json({ error: 'owner only' }, 401)));
app.get('/api/books.beancount', (c) => {
  if (!isOwner(c)) return c.text('owner only', 401);
  c.header('content-type', 'text/plain; charset=utf-8');
  return c.body(beancount());
});

// Live progress of the job currently running for each order (steps + purchases), for the job page.
const liveJobs = new Map<string, { jobId: string; steps: unknown[]; receipt: unknown[] }>();
bus.on('event', (e: SynclyEvent) => {
  if (!e.orderId || !e.jobId) return;
  let l = liveJobs.get(e.orderId);
  if (!l || l.jobId !== e.jobId) liveJobs.set(e.orderId, (l = { jobId: e.jobId, steps: [], receipt: [] }));
  if (e.type === 'step') l.steps.push(e.data);
  if (e.type === 'purchase') l.receipt.push(e.data);
});

app.get('/api/events', (c) =>
  streamSSE(c, async (stream) => {
    const only = c.req.query('order');
    const send = (e: SynclyEvent) => { if (!only || e.orderId === only) void stream.writeSSE({ data: JSON.stringify(scrub(e)), event: e.type }); };
    bus.on('event', send);
    const ping = setInterval(() => void stream.writeSSE({ data: '{}', event: 'ping' }), 20_000);
    await new Promise<void>((resolve) => stream.onAbort(() => resolve()));
    clearInterval(ping);
    bus.off('event', send);
  }),
);

// The web app (web/, Next.js) is its own service and proxies /api here (OUTLAY_API_URL).

setInterval(() => autoAcceptDue(), 60_000);
// jobs a deploy or crash cut off are picked up again once the server is up
setTimeout(() => resumeInterrupted(), 5_000);
// the CFO's side of every open escrow: start funded jobs, submit deliveries, release, refund, cancel
let ticking = false;
async function escrowTick() {
  if (ticking || !escrowConfig().enabled || (!DRY && !hasSeed())) return;
  ticking = true;
  try {
    await refreshBondFree().catch(() => {});
    for (const id of escrowPending()) await syncEscrow(id).catch((e) => console.error(`escrow ${id}: ${e.shortMessage ?? e.message}`));
  } finally {
    ticking = false;
  }
}
setTimeout(escrowTick, 2000);
startTreasury();
startScreening(() => [...payWatchlist(), ...vendorPayees()]);
setInterval(escrowTick, 15_000);
// link each live receipt to its on-chain settlement once Circle Gateway has batched it
const settle = () => void resolveSettlements().then((n) => n && console.log(`settled ${n} receipts on Arc`)).catch(() => {});
setTimeout(settle, 3000);
setInterval(settle, 120_000);
const port = Number(process.env.PORT ?? 8790);
serve({ fetch: app.fetch, port }, () => console.log(`outlay api on :${port} (${DRY ? 'DEMO mode: no money moves' : 'LIVE'})`));
// Which mailer delivers. With Resend, live, one check email goes to Resend's test inbox so a bad key shows in the logs.
console.log(`mail: ${MAILER ?? 'off'}${MAILER === 'resend' ? ` from ${MAIL_FROM}` : ''}`);
if (MAILER === 'resend' && !DRY) resend({ to: 'delivered@resend.dev', subject: 'Syncly mail check', text: 'Startup check.', html: '<p>Startup check.</p>' })
  .then((r) => console.log(`mail check: Resend accepted it (${r.id})`), (e) => console.log(`mail check FAILED: ${e.message}`));
