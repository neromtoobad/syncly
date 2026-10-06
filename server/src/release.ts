// Delivered work becomes the customer's when they accept it (or after the 48 h silence that counts as yes).
// Until then a paid job is a preview: videos and pictures play with a "Preview" mark at a lower resolution,
// nothing downloads, the delivery email carries no files, and a website wears a preview ribbon. A job that is
// rejected or refunded never unlocks, and its website comes down. Free jobs and demo jobs are released at once.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DATA_DIR } from './config.ts';
import { FFMPEG, ffmpeg } from './media.ts';
import { htmlToPng } from './browser.ts';
import type { Order } from './orders.ts';

/** The customer owns the files: accepted, or never paid through escrow (a free or demo job). */
export const released = (o: Order) => o.status === 'accepted' || o.payment?.mode !== 'escrow';
/** Rejected, or refunded at the deadline: the work goes back with the money. */
export const withdrawn = (o: Order) => o.status === 'rejected' || (o.status === 'failed' && !!o.refund);

export const PREVIEW = 'preview-';
const VIDEO = /\.(mp4|webm)$/i, IMAGE = /\.(png|jpe?g|webp)$/i;
export const previewable = (name: string) => VIDEO.test(name) || IMAGE.test(name);
export const jobDir = (o: Order) => { const last = o.runs[o.runs.length - 1]; return last ? join(DATA_DIR, 'jobs', last) : undefined; };

/** Width and height of a video or picture, read from ffmpeg's description of it. */
async function sizeOf(file: string): Promise<[number, number]> {
  const err: string = await promisify(execFile)(FFMPEG, ['-hide_banner', '-i', file]).then(() => '', (e: any) => String(e?.stderr ?? ''));
  const m = err.match(/(?:Video|Stream).*?\b(\d{2,5})x(\d{2,5})\b/);
  if (!m) throw new Error('could not read the size');
  return [Number(m[1]), Number(m[2])];
}

const markHtml = (w: number, h: number) => {
  const big = Math.round(Math.min(w, h) * 0.055), small = Math.max(14, Math.round(Math.min(w, h) * 0.032));
  const row = Array.from({ length: 6 }, () => 'PREVIEW · SYNCLY').join('&nbsp;&nbsp;&nbsp;&nbsp;');
  return `<!doctype html><html><body style="margin:0;width:${w}px;height:${h}px;overflow:hidden;background:transparent;font-family:Arial,Helvetica,sans-serif">
<div style="position:absolute;left:50%;top:50%;width:${Math.round(Math.hypot(w, h) * 1.2)}px;transform:translate(-50%,-50%) rotate(-24deg);display:grid;gap:${Math.round(big * 1.6)}px;text-align:center">
${Array.from({ length: 9 }, (_, i) => `<div style="font-size:${big}px;font-weight:800;letter-spacing:.08em;white-space:nowrap;color:rgba(255,255,255,.30);text-shadow:0 0 2px rgba(0,0,0,.35);margin-left:${(i % 2) * big * 3}px">${row}</div>`).join('')}
</div>
<div style="position:absolute;left:50%;bottom:${Math.round(h * 0.06)}px;transform:translateX(-50%);background:rgba(15,15,15,.72);color:#fff;font-size:${small}px;font-weight:700;padding:${Math.round(small * 0.6)}px ${small}px;border-radius:999px;white-space:nowrap">Preview · the full-quality file unlocks when you accept</div>
</body></html>`;
};

const making = new Map<string, Promise<string>>();
/** The watermarked preview of a delivered video or picture, made once and kept next to the original. */
export function previewFile(o: Order, name: string): Promise<string> | undefined {
  const dir = jobDir(o);
  if (!dir || !previewable(name) || !/^[a-z0-9._-]+$/i.test(name)) return undefined;
  const src = join(dir, name), out = join(dir, PREVIEW + name.replace(IMAGE, '.jpg'));
  if (!existsSync(src)) return undefined;
  if (existsSync(out)) return Promise.resolve(out);
  const key = out;
  if (!making.has(key)) {
    making.set(key, (async () => {
      const [w, h] = await sizeOf(src);
      // a third smaller than the original, mark included, so the preview is for judging, not for posting
      const pw = Math.round((w * 2) / 3 / 2) * 2, ph = Math.round((h * 2) / 3 / 2) * 2;
      const mark = await htmlToPng(markHtml(pw, ph), pw, ph);
      const buf = VIDEO.test(name)
        ? await ffmpeg({ 'in.mp4': readFileSync(src), 'mark.png': mark }, (f, o2) => ['-i', f['in.mp4'], '-i', f['mark.png'], '-filter_complex', `[0:v]scale=${pw}:${ph}[v];[v][1:v]overlay=0:0,format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', o2], 'mp4')
        : await ffmpeg({ 'in.img': readFileSync(src), 'mark.png': mark }, (f, o2) => ['-i', f['in.img'], '-i', f['mark.png'], '-filter_complex', `[0:v]scale=${pw}:${ph}[v];[v][1:v]overlay=0:0`, '-q:v', '6', '-frames:v', '1', o2], 'jpg');
      writeFileSync(out, buf);
      return out;
    })().finally(() => making.delete(key)));
  }
  return making.get(key)!;
}

/** Make every preview as soon as the work is delivered, so the job page opens on them without a wait. */
export function makePreviews(o: Order) {
  if (released(o)) return;
  const dir = jobDir(o);
  if (!dir || !existsSync(dir)) return;
  for (const f of readdirSync(dir)) if (!f.startsWith(PREVIEW) && previewable(f)) void previewFile(o, f)?.catch((e) => console.error(`preview ${o.id}/${f}: ${e?.message ?? e}`));
}

/** The preview ribbon a website wears until its owner accepts it. */
export const SITE_RIBBON = `<div style="position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#151515;color:#fff;font:600 13px/1.4 Arial,Helvetica,sans-serif;text-align:center;padding:9px 14px">Preview · built by Syncly · this site goes fully live when its owner accepts it</div>`;
export const SITE_GONE = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not available</title></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;font-family:Arial,Helvetica,sans-serif;background:#faf7f1;color:#1b1a17"><div style="text-align:center;padding:24px"><h1 style="font-size:22px;margin:0 0 8px">This site is no longer available</h1><p style="color:#6b665c;margin:0">It was a preview that wasn't kept.</p></div></body></html>`;
