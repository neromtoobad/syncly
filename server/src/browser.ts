// Headless Chrome on our own server (free per job): screenshots of the sites the team builds, and
// frame-exact renders of motion reels. On Railway it's Debian's chromium (CHROME_PATH); on a Mac it
// finds Google Chrome. Frames are pure functions of the frame index, so workers render slices in
// parallel and ffmpeg joins them losslessly (the same approach as the ui-motion-reel skill).
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { FFMPEG } from './media.ts';

function chromePath(): string {
  const cache = join(homedir(), '.cache/puppeteer/chrome-headless-shell');
  const shell = existsSync(cache) ? readdirSync(cache).map((d) => join(cache, d, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell')).find(existsSync) : undefined;
  const p = process.env.CHROME_PATH || [
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome',
    shell, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].find((x) => x && existsSync(x));
  if (!p) throw new Error('no Chrome found for rendering (set CHROME_PATH)');
  return p;
}

export async function launch(): Promise<Browser> {
  return puppeteer.launch({
    executablePath: chromePath(), headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--force-color-profile=srgb', '--font-render-hinting=none', '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required'],
  });
}

/** Screenshots of a page (a URL or a local file) at the given viewports. */
export async function screenshots(target: string, views: { name: string; width: number; height: number; full?: boolean }[]): Promise<{ name: string; png: Buffer }[]> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    const out: { name: string; png: Buffer }[] = [];
    for (const v of views) {
      await page.setViewport({ width: v.width, height: v.height, deviceScaleFactor: 1 });
      // A slow font or image must not cost the screenshot: wait for the load, then settle briefly.
      await page.goto(target.startsWith('http') || target.startsWith('file:') ? target : `file://${target}`, { waitUntil: 'load', timeout: 45_000 }).catch(() => undefined);
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 8000 }).catch(() => undefined);
      // A one-shot capture never scrolls, so show everything that reveals on scroll; in a full-page
      // shot, fixed bars would be painted mid-page, so hide them there.
      await page.evaluate(async (full) => {
        document.querySelectorAll('.rv').forEach((e) => e.classList.add('in'));
        // scroll through like a visitor so lazy images and maps load, then wait for every image
        for (let y = 0; y < document.body.scrollHeight; y += Math.round(innerHeight * 0.8)) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
        scrollTo(0, 0);
        const imgs = [...document.images] as HTMLImageElement[];
        imgs.forEach((i) => { i.loading = 'eager'; });
        await Promise.all(imgs.map((i) => (i.complete && i.naturalWidth ? null : new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); setTimeout(r, 5000); }))));
        if (full) { const st = document.createElement('style'); st.textContent = '.bar,.float-wa{display:none!important}*{animation:none!important;transition:none!important}'; document.head.appendChild(st); }
      }, !!v.full).catch(() => undefined);
      const png = v.full ? await page.screenshot({ type: 'png', fullPage: true, captureBeyondViewport: true }).catch(() => page.screenshot({ type: 'png' })) : await page.screenshot({ type: 'png' });
      out.push({ name: v.name, png: Buffer.from(png) });
    }
    return out;
  } finally { await browser.close(); }
}

type Scene = { browser: Browser; page: Page; total: number; fps: number; errors: string[] };
async function openScene(file: string, size: [number, number]): Promise<Scene> {
  const browser = await launch();
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String((e as Error).message ?? e)));
  await page.setViewport({ width: size[0], height: size[1], deviceScaleFactor: 1 });
  await page.goto(`file://${file}`, { waitUntil: 'networkidle0', timeout: 60_000 });
  await page.evaluate(() => (window as any).READY);
  const info = await page.evaluate(() => ({ total: (window as any).TOTAL_FRAMES, fps: (window as any).FPS || 60 }));
  return { browser, page, errors, ...info };
}

/** Stills of a reel scene at the given times (seconds), plus any page errors. */
export async function reelStills(file: string, size: [number, number], times: number[] | 'states'): Promise<{ stills: { t: number; png: Buffer }[]; errors: string[]; total: number; fps: number }> {
  const s = await openScene(file, size);
  try {
    const stills = [];
    // 'states': one still in the middle of each state, where its content is at rest.
    // __starts holds the start of every state after the first, in seconds.
    const cuts: number[] = times === 'states' ? [0, ...(await s.page.evaluate(() => (window as any).__starts ?? [])), s.total / s.fps] : [];
    const at = times === 'states' ? cuts.slice(0, -1).map((a, i) => (a + cuts[i + 1]) / 2) : times;
    for (const t of at) {
      await s.page.evaluate((n) => (window as any).renderFrame(n), Math.min(s.total - 1, Math.round(t * s.fps)));
      stills.push({ t, png: Buffer.from(await s.page.screenshot({ type: 'png' })) });
    }
    return { stills, errors: s.errors, total: s.total, fps: s.fps };
  } finally { await s.browser.close(); }
}

/** The reel's own score (Web Audio, rendered offline in the page), as WAV. */
export async function reelAudio(file: string, size: [number, number]): Promise<Buffer | undefined> {
  const s = await openScene(file, size);
  try {
    const res = await s.page.evaluate(() => (window as any).renderAudio?.());
    return res?.wav ? Buffer.from(res.wav, 'base64') : undefined;
  } finally { await s.browser.close(); }
}

/** Render every frame to an MP4 (H.264, yuv420p), with the score muxed in and loudness-normalised. */
export async function renderReel(file: string, size: [number, number], out: string, opts: { workers?: number; audio?: Buffer; onProgress?: (done: number, total: number) => void } = {}): Promise<{ frames: number; fps: number; errors: string[] }> {
  const probe = await openScene(file, size);
  const { total, fps } = probe;
  await probe.browser.close();
  const workers = Math.max(1, Math.min(opts.workers ?? 2, 4));
  const span = Math.ceil(total / workers);
  const segs: string[] = [], errors: string[] = [];
  let done = 0;
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const a = w * span, b = Math.min(total, a + span);
    if (a >= b) return;
    const seg = `${out}.seg${w}.mp4`;
    segs[w] = seg;
    const s = await openScene(file, size);
    const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(fps), '-g', String(fps * 2), seg], { stdio: ['pipe', 'ignore', 'pipe'] });
    try {
      for (let f = a; f < b; f++) {
        await s.page.evaluate((n) => (window as any).renderFrame(n), f);
        const png = await s.page.screenshot({ type: 'png', optimizeForSpeed: true });
        if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
        if (++done % 60 === 0) opts.onProgress?.(done, total);
      }
    } finally {
      ff.stdin.end();
      await new Promise((r) => ff.on('close', r));
      errors.push(...s.errors);
      await s.browser.close();
    }
  }));
  const list = `${out}.segs.txt`;
  writeFileSync(list, segs.filter(Boolean).map((s) => `file '${s}'`).join('\n'));
  const wav = opts.audio ? `${out}.score.wav` : undefined;
  if (wav) writeFileSync(wav, opts.audio!);
  const args = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list];
  if (wav) args.push('-i', wav, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest');
  else args.push('-c', 'copy');
  args.push('-movflags', '+faststart', out);
  const code = await new Promise<number>((r) => spawn(FFMPEG, args, { stdio: 'ignore' }).on('close', (c) => r(c ?? 1)));
  for (const s of segs) if (s) rmSync(s, { force: true });
  rmSync(list, { force: true });
  if (wav) rmSync(wav, { force: true });
  if (code !== 0 || !existsSync(out)) throw new Error('ffmpeg could not join the rendered segments');
  return { frames: total, fps, errors };
}

/** An HTML snippet rendered to a PNG (transparent where the page has no background): overlays, end cards. */
export async function htmlToPng(html: string, width: number, height: number): Promise<Buffer> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30_000 }).catch(() => undefined);
    await page.evaluate(() => (document as any).fonts?.ready);
    return Buffer.from(await page.screenshot({ type: 'png', omitBackground: true }));
  } finally { await browser.close(); }
}

/** A poster page (site/poster.ts) to a print PDF at its exact size, or a PNG at `scale`× for sharing. */
export async function renderPoster(html: string, w: number, h: number, kind: 'pdf' | 'png', scale = 2): Promise<Buffer> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: kind === 'png' ? scale : 1 });
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 }).catch(() => undefined);
    await page.waitForFunction('window.POSTER_READY === true', { timeout: 10_000 }).catch(() => undefined);
    if (kind === 'pdf') return Buffer.from(await page.pdf({ width: `${w}px`, height: `${h}px`, printBackground: true, pageRanges: '1' }));
    return Buffer.from(await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: w, height: h } }));
  } finally { await browser.close(); }
}
