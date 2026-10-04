// The Messenger emails every delivery to the customer.
//   RESEND_API_KEY set:         Resend, from MAIL_FROM (default "Syncly <hello@hiresyncly.site>"); used whenever
//                               the key is there, unless AgentMail is asked for by name
//   OUTLAY_MAIL=aisa (default without Resend): AgentMail via AIsa, paid by x402 from the Messenger's Gateway
//                               balance (a line on the job's receipt): 0.10 USDC for the mailbox once, 0.10 per email
//   OUTLAY_MAIL=orthogonal:     AgentMail via Orthogonal, 2 USDC a month for the mailbox, 0.01 per email
//                               (too big for a job's budget: open it once yourself and set OUTLAY_MAIL_INBOX)
//   OUTLAY_MAIL=off:            no emails unless Resend is set up (the job page is still the delivery)
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { marked } from 'marked';
import { DATA_DIR, DRY } from './config.ts';
import { buy } from './x402.ts';
import type { Job } from './job.ts';
import type { Order } from './orders.ts';
import { editLinkFor } from './site/edit.ts';

const PRESETS = {
  aisa: { vendor: 'AgentMail (AIsa)', base: 'https://api.aisa.one/apis/v2/agentmail', inboxUsd: 0.1, sendUsd: 0.1 },
  orthogonal: { vendor: 'AgentMail (Orthogonal)', base: 'https://np.orthogonal.com/agentmail/v0', inboxUsd: 2, sendUsd: 0.01 },
} as const;
const want = process.env.OUTLAY_MAIL;
const RESEND_KEY = process.env.RESEND_API_KEY?.trim() || undefined;
export const MAIL_FROM = process.env.MAIL_FROM?.trim() || 'Syncly <hello@hiresyncly.site>';
export const MAILER: 'resend' | 'agentmail' | null = want === 'aisa' || want === 'orthogonal' ? 'agentmail' : RESEND_KEY ? 'resend' : want === 'off' ? null : 'agentmail';
/** AgentMail's x402 seller, when that is the mailer (Resend is a plain API, outside the agents' budgets). */
export const MAIL = MAILER === 'agentmail' ? PRESETS[(want ?? 'aisa') as keyof typeof PRESETS] ?? PRESETS.aisa : null;
export const MAIL_HOST = MAIL ? new URL(MAIL.base).host : '';
/** Mail costs each service's budget must leave room for: the per-email price plus the one-off mailbox. */
export const MAIL_BUDGET_USD = MAIL ? MAIL.sendUsd + Math.min(MAIL.inboxUsd, 0.1) : 0;

export const PUBLIC_URL = process.env.OUTLAY_PUBLIC_URL ?? 'https://hiresyncly.site';
const SERVICE: Record<string, string> = {
  'research-brief': 'Research Brief', 'local-business-finder': 'Local Business Finder', 'lead-list': 'Lead List',
  'content-pack': 'Content Pack', website: 'Website', 'motion-ad': 'Motion Ad', 'video-ad': 'Video Ad',
  'ai-answer-audit': 'AI Answer Audit', 'best-price': 'Best Price Finder', 'vendor-check': 'Check Before You Pay',
  'ad-launch': 'Ad Launch', 'product-photos': 'Product Photo Studio', 'get-found': 'Get Found', 'buy-smart': 'Buy Smart',
};
export const maskEmail = (e: string) => e.replace(/^(.).*(@.*)$/, '$1•••$2');

// The mailbox is opened once (paid by the first job that needs it) and remembered on the data volume.
const boxFile = () => join(DATA_DIR, 'mailbox.json');
let opening: Promise<string> | null = null;
let demoBox: string | undefined; // demo mode "opens" it once per run, in memory only
function mailbox(job: Job): Promise<string> {
  if (process.env.OUTLAY_MAIL_INBOX) return Promise.resolve(process.env.OUTLAY_MAIL_INBOX);
  if (demoBox) return Promise.resolve(demoBox);
  if (existsSync(boxFile())) return Promise.resolve(JSON.parse(readFileSync(boxFile(), 'utf8')).inbox_id);
  return (opening ??= (async () => {
    const r = await buy<{ inbox_id?: string; id?: string }>(job, {
      agent: 'messenger', vendor: MAIL!.vendor, url: `${MAIL!.base}/inboxes`, body: { username: 'syncly', display_name: 'Syncly' },
      reason: "open Syncly's mailbox (once, for every delivery after this one)", maxUsd: MAIL!.inboxUsd * 1.05, expectUsd: MAIL!.inboxUsd,
      dryData: () => ({ inbox_id: 'syncly@agentmail.to' }),
    });
    const id = r.inbox_id ?? r.id;
    if (!id) throw new Error('the mail service did not return a mailbox');
    if (job.receipt.at(-1)?.dry) demoBox = id;
    else { mkdirSync(DATA_DIR, { recursive: true }); writeFileSync(boxFile(), JSON.stringify({ inbox_id: id, vendor: MAIL!.vendor, at: new Date().toISOString() })); }
    return id;
  })().finally(() => { opening = null; }));
}

// Scraped names and addresses end up in deliverables; neutralise any HTML before rendering the email.
// Mail apps ignore stylesheets, so tables get inline styles.
const render = (md: string) => (marked.parse(md.replace(/</g, '&lt;'), { async: false }) as string)
  .replace(/<table>/g, '<table style="border-collapse:collapse;width:100%;font-size:13px">')
  .replace(/<th([ >])/g, '<th style="text-align:left;padding:6px 8px;border-bottom:2px solid #ddd4c2"$1')
  .replace(/<td([ >])/g, '<td style="padding:6px 8px;border-bottom:1px solid #ebe5d8;vertical-align:top"$1');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function compose(job: Pick<Job, 'deliverable' | 'files'>, o: Order) {
  const link = `${PUBLIC_URL}/job/${o.id}`;
  const edit = o.service === 'website' ? editLinkFor(o.id, PUBLIC_URL) : undefined;
  const name = SERVICE[o.service] ?? o.service;
  const revised = o.revisionNote !== undefined;
  // A subject is one line (Resend refuses a newline, and form briefs have several): the business name, or the brief's start.
  const about = String((o as any).details?.name || o.brief).replace(/\s+/g, ' ').trim();
  const brief = about.length > 70 ? about.slice(0, 68) + '…' : about;
  const decide = o.escrow
    ? `Your ${o.quote.priceUsd.toFixed(2)} USDC is waiting in escrow on Arc. On the job page, from the wallet that paid, accept to release it, ask for your one free revision, or reject it and get it back plus a ${o.quote.bondUsd.toFixed(2)} USDC bond. Silence for 48 hours counts as acceptance.`
    : o.quote.promo
      ? 'This one was your free first job. Tell us on the job page if it was good.'
      : 'Accept, revise or reject it on the job page.';
  const subject = `${revised ? 'Revised: ' : ''}your ${name} is ready · ${brief}`;
  const text = `The Syncly team finished your job.\n\n"${o.brief}"\n\n${job.deliverable}\n\n${edit ? `Edit your site yourself (prices, hours, menu, Chowdeck and payment links, bank details, photos, colours): ${edit}\nKeep this link to yourself: anyone with it can change your site.\n\n` : ''}${decide}\n${link}\n\nYour job page shows every step the team took. ${MAIL ? 'This email was sent and paid for by our Messenger agent, in USDC on Arc.' : 'This email was sent by our Messenger agent.'}\n`;
  const html = `<div style="background:#faf7f1;padding:28px 12px;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#1b1a17">
<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #ebe5d8;border-radius:18px;padding:28px">
<div style="font-family:Georgia,serif;letter-spacing:.18em;font-size:14px;color:#17473b;margin-bottom:18px">SYNCLY</div>
<p style="font-size:16px;margin:0 0 6px">The team finished your ${esc(name)}${revised ? ', revised with your note' : ''}.</p>
<p style="font-size:14px;color:#4b4841;margin:0 0 18px">"${esc(o.brief)}"</p>
<p style="margin:0 0 22px"><a href="${link}" style="display:inline-block;background:#17473b;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:600;font-size:14px">Review &amp; decide →</a></p>
<div style="font-size:14px;line-height:1.55;border-top:1px solid #ebe5d8;padding-top:14px">${render(job.deliverable)}</div>
${edit ? `<div style="border:1px solid #cfe0d8;background:#f1f7f4;border-radius:14px;padding:14px 16px;margin:18px 0 0"><p style="font-size:14px;margin:0 0 8px;font-weight:600">Edit your site yourself</p><p style="font-size:13.5px;color:#4b4841;margin:0 0 12px">Prices, hours, your menu, your Chowdeck, Glovo, Paystack or booking link, bank details for transfers, photos and colours. Changes go live in seconds, and you can undo.</p><a href="${edit}" style="display:inline-block;background:#fff;color:#17473b;border:1px solid #17473b;text-decoration:none;padding:9px 16px;border-radius:999px;font-weight:600;font-size:13.5px">Open your site editor →</a><p style="font-size:12px;color:#847d70;margin:10px 0 0">Keep this link to yourself: anyone with it can change your site.</p></div>` : ''}
<p style="font-size:13.5px;color:#4b4841;background:#f3eee4;border-radius:12px;padding:12px 14px;margin:18px 0 0">${esc(decide)}</p>
<p style="font-size:12px;color:#847d70;margin:18px 0 0">Your <a href="${link}" style="color:#17473b">job page</a> shows every step the team took. ${MAIL ? 'This email was sent, and paid for, by our Messenger agent in USDC on Arc.' : 'This email was sent by our Messenger agent.'}</p>
</div></div>`;
  // Text files ride along; images, video and sites are linked from the order page instead (mail size).
  const attachments = job.files.filter((f) => typeof f.content === 'string' && f.content.length < 2_000_000)
    .map((f) => ({ filename: f.name, content_type: f.name.endsWith('.csv') ? 'text/csv' : 'text/plain', content: Buffer.from(f.content).toString('base64') }));
  return { subject, text, html, attachments };
}

/** Send one email through Resend. Demo mode never sends. */
export async function resend(m: { to: string; subject: string; text: string; html: string; attachments?: { filename: string; content: string }[] }): Promise<{ id: string }> {
  if (!RESEND_KEY) throw new Error('Resend is not set up (RESEND_API_KEY)');
  if (DRY) return { id: 'demo-not-sent' };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { authorization: `Bearer ${RESEND_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to: [m.to], subject: m.subject, text: m.text, html: m.html, ...(process.env.MAIL_REPLY_TO ? { reply_to: process.env.MAIL_REPLY_TO } : {}), ...(m.attachments?.length ? { attachments: m.attachments } : {}) }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Resend ${r.status}: ${j?.message ?? j?.name ?? 'send failed'}`);
  return { id: String(j?.id ?? '') };
}

/** Email the delivery. Never fails the job: a problem is logged on the job and the page still has everything. */
export async function emailDelivery(job: Job, o: Order) {
  if (!MAILER || job.status !== 'delivered') return;
  const to = maskEmail(o.email);
  try {
    job.log('messenger', 'email', `sending the delivery to ${to}`);
    if (MAILER === 'resend') {
      const { subject, text, html, attachments } = compose(job, o);
      const r = await resend({ to: o.email, subject, text, html, attachments: attachments.map(({ filename, content }) => ({ filename, content })) });
      job.log('messenger', 'emailed', `delivered to ${to}${DRY ? ' (demo: not really sent)' : ` (${r.id.slice(0, 8)})`}`);
      job.save();
      return;
    }
    const inbox = await mailbox(job);
    const { subject, text, html, attachments } = compose(job, o);
    await buy(job, {
      agent: 'messenger', vendor: MAIL!.vendor, url: `${MAIL!.base}/inboxes/${encodeURIComponent(inbox)}/messages/send`,
      body: { to: [o.email], subject, text, html, attachments },
      reason: `email the delivery to ${to}`, maxUsd: MAIL!.sendUsd * 1.05, expectUsd: MAIL!.sendUsd,
      dryData: () => ({ message_id: 'dry-run' }),
    });
    job.log('messenger', 'emailed', `delivered to ${to}`);
  } catch (e: any) {
    job.log('messenger', 'email failed', `${String(e?.message ?? e).slice(0, 90)}. The job page has everything.`);
  }
  job.save();
}
