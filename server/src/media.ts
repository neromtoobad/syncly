// Pictures, video and sound for the growth team, bought per call from BlockRun on Arc (Gateway-paid
// on nano.blockrun.ai). Video is async: submitted, then polled with the same payment, and it only
// settles when the clip is ready, so a failed render costs nothing. Local finishing (captions, end
// cards, resizing) is ffmpeg on our own server, which costs nothing per job.
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import { buy } from './x402.ts';
import { DRY } from './config.ts';
import { HOSTS } from './tools.ts';
import type { Job } from './job.ts';
import type { Role } from './wallets.ts';
import { fetchPublic } from './net.ts';

const run = promisify(execFile);
export const FFMPEG: string = (ffmpegPath as any).path;

export const IMAGE_USD: Record<string, number> = { 'openai/gpt-image-1': 0.02, 'google/nano-banana': 0.05, 'openai/gpt-image-2': 0.06, 'google/nano-banana-pro': 0.1 };
export const VIDEO_USD_PER_S: Record<string, number> = { 'bytedance/seedance-1.5-pro': 0.098, 'bytedance/seedance-2.0-fast': 0.255, 'bytedance/seedance-2.0': 0.319, 'xai/grok-imagine-video': 0.05 };

/** Fetch a finished file from a seller's URL (or a data URI), with a size limit. */
export async function download(url: string, maxMb = 80): Promise<Buffer> {
  if (url.startsWith('data:')) return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  // Only public addresses (never our own server or the private network), with a timeout and a size cap.
  const res = await fetchPublic(url, { maxBytes: maxMb * 1e6, timeoutMs: 120_000 });
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  return res.buf;
}

const firstUrl = (d: any): string | undefined =>
  d?.data?.[0]?.url ?? (d?.data?.[0]?.b64_json ? `data:image/png;base64,${d.data[0].b64_json}` : undefined)
  ?? d?.video_url ?? d?.url ?? d?.output?.url ?? d?.result?.url ?? d?.video?.url ?? d?.audio_url ?? d?.data?.url;

/** A data URI, typed from the file's first bytes (uploads are JPEG, generated images PNG). */
export const dataUri = (buf: Buffer, mime = buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : 'image/png') => `data:${mime};base64,${buf.toString('base64')}`;

// ---------- dry-mode stand-ins, so a demo run produces real files to look at

async function dryPng(label: string, w = 1024, h = 1024): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'syncly-dry-'));
  try {
    const out = join(dir, 'x.png');
    const colour = DRY_COLOURS[[...label].reduce((a, c) => a + c.charCodeAt(0), 0) % DRY_COLOURS.length];
    await run(FFMPEG, ['-y', '-f', 'lavfi', '-i', `color=c=0x${colour}:s=${w}x${h}`, '-frames:v', '1', out]);
    return readFileSync(out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
async function dryMp4(seconds: number, w = 720, h = 1280): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'syncly-dry-'));
  try {
    const out = join(dir, 'x.mp4');
    await run(FFMPEG, ['-y', '-f', 'lavfi', '-i', `testsrc2=s=${w}x${h}:d=${seconds}:r=24`, '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', out]);
    return readFileSync(out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const DRY_COLOURS = ['2E7A38', 'C8902F', '4B8DCF', '8F5FC0', '04A19B', '13271C'];

// Demo pictures: with OUTLAY_DRY_IMAGES=<folder>, a dry run serves real pictures from that folder in call
// order (1.png, 2.jpg, …) and writes each call's prompt beside it (1.txt, …), so an example run can show
// realistic output. A dry clip becomes a slow push-in on the run's first picture; dry music is skipped.
const DEMO = DRY ? process.env.OUTLAY_DRY_IMAGES : undefined;
let demoCall = 0, demoFirst: Buffer | undefined;
async function demoPicture(prompt: string, w: number, h: number): Promise<Buffer> {
  if (!DEMO) return dryPng(prompt, w, h);
  const n = ++demoCall;
  writeFileSync(join(DEMO, `${n}.txt`), prompt);
  const f = ['png', 'jpg', 'jpeg'].map((x) => join(DEMO, `${n}.${x}`)).find((x) => existsSync(x));
  const buf = f ? readFileSync(f) : await dryPng(prompt, w, h);
  demoFirst ??= f ? buf : undefined;
  return buf;
}
async function demoClip(seconds: number): Promise<Buffer> {
  if (!DEMO || !demoFirst) return dryMp4(seconds);
  const fr = seconds * 30;
  return ffmpeg({ 'still.png': demoFirst }, (f, out) => ['-loop', '1', '-i', f['still.png'], '-vf', `scale=1440:2560:force_original_aspect_ratio=increase,crop=1440:2560,zoompan=z='1+0.12*on/${fr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${fr}:s=1080x1920:fps=30`, '-t', String(seconds), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out]);
}

// ---------- paid generation

export async function image(job: Job, agent: Role, o: { prompt: string; model?: string; size?: '1024x1024' | '1024x1792' | '1792x1024'; reason: string }): Promise<{ buf: Buffer; url?: string }> {
  const model = o.model ?? 'google/nano-banana-pro';
  const usd = IMAGE_USD[model] ?? 0.1;
  const data = await buy<any>(job, {
    agent, vendor: `BlockRun ${model.split('/')[1]}`, url: `https://${HOSTS.blockrun}/api/v1/images/generations`,
    body: { model, prompt: o.prompt.slice(0, 4000), size: o.size ?? '1024x1024', n: 1 }, reason: o.reason,
    expectUsd: usd, maxUsd: usd * 1.6 + 0.01, dryData: () => ({ data: [{ url: 'dry://image' }] }),
  });
  if (DRY) { const [w, h] = (o.size ?? '1024x1024').split('x').map(Number); return { buf: await demoPicture(o.prompt, w / 2, h / 2) }; }
  const url = firstUrl(data);
  if (!url) throw new Error(`${model}: no image in the response`);
  return { buf: await download(url, 20), url: url.startsWith('data:') ? undefined : url };
}

/** Edit or combine images (e.g. the customer's product photo + a scene), up to 3 sources for Google models. */
export async function editImage(job: Job, agent: Role, o: { prompt: string; images: Buffer[]; model?: string; size?: string; reason: string }): Promise<{ buf: Buffer; url?: string }> {
  const model = o.model ?? 'google/nano-banana-pro';
  const usd = IMAGE_USD[model] ?? 0.1;
  const data = await buy<any>(job, {
    agent, vendor: `BlockRun ${model.split('/')[1]} edit`, url: `https://${HOSTS.blockrun}/api/v1/images/image2image`,
    body: { model, prompt: o.prompt.slice(0, 4000), image: o.images.length === 1 ? dataUri(o.images[0]) : o.images.slice(0, 3).map((b) => dataUri(b)), ...(o.size ? { size: o.size } : {}) },
    reason: o.reason, expectUsd: usd, maxUsd: usd * 1.6 + 0.01, dryData: () => ({ data: [{ url: 'dry://image' }] }),
  });
  if (DRY) return { buf: await demoPicture(o.prompt, 512, 896) };
  const url = firstUrl(data);
  if (!url) throw new Error(`${model}: no image in the response`);
  return { buf: await download(url, 20), url: url.startsWith('data:') ? undefined : url };
}

/** A generated clip. `imageUrl` (a public URL) animates a still; otherwise it's text-to-video. */
export async function video(job: Job, agent: Role, o: { prompt: string; imageUrl?: string; model?: string; seconds?: number; reason: string }): Promise<Buffer> {
  const model = o.model ?? 'bytedance/seedance-2.0-fast';
  const seconds = o.seconds ?? 5;
  const usd = (VIDEO_USD_PER_S[model] ?? 0.32) * seconds;
  const data = await buy<any>(job, {
    agent, vendor: `BlockRun ${model.split('/')[1]}`, url: `https://${HOSTS.blockrun}/api/v1/videos/generations`,
    body: { model, prompt: o.prompt.slice(0, 4000), duration_seconds: seconds, ...(o.imageUrl ? { image_url: o.imageUrl } : {}) },
    reason: o.reason, expectUsd: usd, maxUsd: usd * 1.3 + 0.02,
    poll: (d) => d?.poll_url ?? (d?.id && d?.status && !firstUrl(d) ? `/api/v1/videos/generations/${d.id}` : undefined),
    dryData: () => ({ status: 'completed', data: [{ url: 'dry://video' }] }),
  });
  if (DRY) return demoClip(seconds);
  const url = firstUrl(data);
  if (!url) throw new Error(`${model}: finished, but no video URL in the response`);
  return download(url, 80);
}

/** An instrumental track (MiniMax Music), for ads that need music rather than a synthesised score. */
export async function music(job: Job, agent: Role, o: { prompt: string; seconds: number; reason: string }): Promise<Buffer> {
  const data = await buy<any>(job, {
    agent, vendor: 'BlockRun MiniMax music', url: `https://${HOSTS.blockrun}/api/v1/audio/generations`,
    body: { model: 'minimax/music-2.5+', prompt: o.prompt.slice(0, 1000), instrumental: true, duration_seconds: Math.max(5, Math.min(60, Math.round(o.seconds))) },
    reason: o.reason, expectUsd: 0.107, maxUsd: 0.2, dryData: () => ({ url: 'dry://audio' }),
  });
  if (DRY && DEMO) throw new Error('no music in demo pictures mode');
  if (DRY) {
    const dir = mkdtempSync(join(tmpdir(), 'syncly-dry-'));
    try { const out = join(dir, 'x.mp3'); await run(FFMPEG, ['-y', '-f', 'lavfi', '-i', `sine=f=220:d=${o.seconds}`, out]); return readFileSync(out); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  }
  const url = firstUrl(data);
  if (!url) throw new Error('music: no audio URL in the response');
  return download(url, 20);
}

// ---------- local finishing with ffmpeg (free)

/** Run ffmpeg over named input buffers; returns the output file. */
export async function ffmpeg(inputs: Record<string, Buffer>, args: (files: Record<string, string>, out: string) => string[], ext = 'mp4'): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'syncly-ff-'));
  try {
    const files: Record<string, string> = {};
    for (const [name, buf] of Object.entries(inputs)) writeFileSync((files[name] = join(dir, name)), buf);
    const out = join(dir, `out.${ext}`);
    await run(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args(files, out)], { maxBuffer: 1 << 24, timeout: 240_000 });
    return readFileSync(out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
