// Bank statements for the Money Report. They hold a person's or a business's finances, so they are handled apart
// from the public photo uploads: stored under a random id in their own folder, never served back over HTTP, and
// deleted when the report is done. A PDF or CSV is turned into text the moment it arrives and only the text is
// kept; a statement password, if the bank set one, is used for that and then forgotten. Screenshots are kept as
// images (re-encoded, which drops their metadata) until the report has read them.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { extractText, getDocumentProxy } from 'unpdf';
import { DATA_DIR } from './config.ts';
import { prepPhoto } from './site/photos.ts';

const dir = () => { const d = join(DATA_DIR, 'statements'); mkdirSync(d, { recursive: true }); return d; };
const ID = /^st_[a-f0-9]{16}$/;
export const STATEMENT_MAX_BYTES = 15 * 1024 * 1024;
export const statementExists = (id: string) => ID.test(id) && (existsSync(join(dir(), `${id}.txt`)) || existsSync(join(dir(), `${id}.jpg`)));

export type StatementFile = { id: string; kind: 'text' | 'image'; pages?: number; lines?: number };

/** Store one statement file: PDF and CSV/TXT become text (only the text is kept), images are re-encoded. */
export async function saveStatement(buf: Buffer, name: string, password?: string): Promise<StatementFile> {
  if (buf.length > STATEMENT_MAX_BYTES) throw new Error(`${name} is over 15 MB.`);
  const id = `st_${randomBytes(8).toString('hex')}`;
  const isPdf = buf.subarray(0, 5).toString() === '%PDF-';
  if (isPdf) {
    let text = '', pages = 0;
    try {
      const pdf = await getDocumentProxy(new Uint8Array(buf), password ? { password } : {});
      const r = await extractText(pdf, { mergePages: false });
      pages = r.totalPages;
      text = (r.text as string[]).map((t, i) => `--- page ${i + 1} ---\n${t}`).join('\n');
    } catch (e: any) {
      const m = String(e?.name ?? '') + String(e?.message ?? e);
      if (/password/i.test(m)) throw new Error(password ? `The password for ${name} didn't open it. Check it and try again.` : `${name} is locked with a password. Add the password your bank gave you (it's used once to read the file, then forgotten).`);
      throw new Error(`We couldn't read ${name}. Try the PDF straight from your bank or a CSV export.`);
    }
    if (text.replace(/\s/g, '').length < 200) throw new Error(`${name} has no readable text (it may be a scan). Send a screenshot of each page instead, or the PDF from your bank app.`);
    writeFileSync(join(dir(), `${id}.txt`), text);
    return { id, kind: 'text', pages, lines: text.split('\n').length };
  }
  const head = buf.subarray(0, 4);
  const isImage = (head[0] === 0xff && head[1] === 0xd8) || head.toString('hex') === '89504e47' || buf.subarray(8, 12).toString() === 'WEBP';
  if (isImage) {
    const img = await prepPhoto(buf, 2400, 3).catch(() => { throw new Error(`${name} is not an image we can read.`); });
    writeFileSync(join(dir(), `${id}.jpg`), img.buf);
    return { id, kind: 'image' };
  }
  // CSV or plain text exports
  const text = buf.toString('utf8');
  if (!/\d/.test(text) || text.includes('\u0000')) throw new Error(`${name} isn't a PDF, CSV or picture we can read. Excel files: save as CSV first.`);
  writeFileSync(join(dir(), `${id}.txt`), text.slice(0, 2_000_000));
  return { id, kind: 'text', lines: text.split('\n').length };
}

export function readStatement(id: string): { kind: 'text'; text: string } | { kind: 'image'; buf: Buffer } | undefined {
  if (!ID.test(id)) return undefined;
  const t = join(dir(), `${id}.txt`), j = join(dir(), `${id}.jpg`);
  if (existsSync(t)) return { kind: 'text', text: readFileSync(t, 'utf8') };
  if (existsSync(j)) return { kind: 'image', buf: readFileSync(j) };
  return undefined;
}

/** Delete statement files: after the report, and any left over a day after upload. */
export function deleteStatements(ids: string[]) { for (const id of ids) if (ID.test(id)) for (const ext of ['txt', 'jpg']) rmSync(join(dir(), `${id}.${ext}`), { force: true }); }
export function sweepStatements(maxAgeMs = 24 * 3600_000) {
  const now = Date.now();
  for (const f of readdirSync(dir())) { try { const p = join(dir(), f); if (now - statSync(p).mtimeMs > maxAgeMs) rmSync(p, { force: true }); } catch { /* skip */ } }
}

// A small per-address limit so the endpoint can't be used as free storage.
const recent = new Map<string, number[]>();
export function allowStatement(who: string, n: number): boolean {
  const now = Date.now(), list = (recent.get(who) ?? []).filter((t) => now - t < 3600_000);
  if (list.length + n > 20) return false;
  recent.set(who, [...list, ...Array(n).fill(now)]);
  return true;
}
