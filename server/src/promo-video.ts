// A short promo-engine video from a storyboard written in code (no model, no paid video API): the photos go into a
// scene folder, a licensed track sets the beat (or an original score when it won't download), the storyboard is
// cleaned and cut on that beat, and our headless Chrome renders every frame. Used by Ad Campaign for one video per
// angle; Motion Ad has its own storyboard-from-a-model path in services/motion-ad.ts.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Job } from './job.ts';
import { ffmpeg } from './media.ts';
import { reelAudio, reelStills, renderReel } from './browser.ts';
import { cleanStoryboard, pickMusic, preparePhoto, writePromo, type Photo, type Storyboard } from './promo.ts';
import { pickTrack, trackAudio, trackGrid, type Track } from './music.ts';

export type PromoOut = { mp4: Buffer; seconds: number; track?: Track; music?: string; stills: Buffer[] };

/**
 * Render `board` to an MP4. `photos[i]` is saved as its `name`, else photo-(i+1), and the board refers to it by that
 * name. Only photo-N files count as the owner's own pictures (the cleaner always puts those on screen), so a staged or
 * generated scene should be named otherwise (e.g. "scene"). `hookPhoto` puts that photo behind the opening hook. `seed` picks the text style and transitions, so videos for
 * the same business can still move differently. Returns the video and a still of each scene for the vision check.
 */
export async function promoVideo(job: Job, o: {
  board: Storyboard; photos: { buf: Buffer; about: string; name?: string }[]; logo?: Buffer; business: string; cta: string;
  colour?: string; mood: string; seconds: number; size: [number, number]; seed?: number; hookPhoto?: number; track?: Track; label?: string;
}): Promise<PromoOut> {
  const work = mkdtempSync(join(tmpdir(), 'promo-'));
  try {
    const photos: Photo[] = [], files: { name: string; buf: Buffer }[] = [];
    let logo: string | undefined;
    if (o.logo) { const r = await preparePhoto(o.logo, 'logo', 'their logo', 600); logo = r.photo.name; files.push(r.file); }
    for (const [i, p] of o.photos.entries()) { const r = await preparePhoto(p.buf, p.name ?? `photo-${i + 1}`, p.about); photos.push(r.photo); files.push(r.file); }
    // a Mixkit track (licensed for online ads) sets the beat; an original score if it won't download
    let track: Track | undefined = o.track ?? pickTrack(o.mood);
    let grid: { bpm: number; start: number } | undefined;
    try { grid = await trackGrid(track); } catch { track = undefined; }
    const music = track ? undefined : pickMusic(o.mood);
    const bpm = grid?.bpm ?? 120;
    // board photo names may say "photo-1" for a file saved as photo-1.png or photo-1.jpg
    const named = (n: string) => photos.find((p) => p.name.replace(/\.\w+$/, '') === n.replace(/\.\w+$/, ''))?.name ?? n;
    const board: Storyboard = { ...o.board, scenes: o.board.scenes.map((s: any) => ({ ...s, ...(s.photo ? { photo: named(s.photo) } : {}), ...(s.photos ? { photos: s.photos.map(named) } : {}) })) };
    const sb = cleanStoryboard(board, { seconds: o.seconds, photos, cta: o.cta, business: o.business, brandColour: o.colour, beat: 60 / bpm });
    if (o.hookPhoto != null && photos[o.hookPhoto] && sb.scenes[0]?.type === 'hook') (sb.scenes[0] as any).photo = photos[o.hookPhoto].name;
    const seconds = Math.round(sb.scenes.reduce((a, x) => a + x.dur, 0) * 1000) / 1000;
    const file = writePromo(work, sb, { size: o.size, fps: 30, business: o.business, logo, photos, files, music, bpm, seed: o.seed });
    let wav: Buffer | undefined;
    if (track) {
      const sfx = await reelAudio(file, o.size, { musicLevel: 0, hitBells: false }).catch(() => undefined);
      wav = await trackAudio(track, seconds, { sfx }).catch(() => undefined);
    }
    if (!wav) wav = await reelAudio(file, o.size);
    job.log('producer', 'render', `${o.label ? `${o.label}: ` : ''}${sb.scenes.map((s) => s.type).join(' → ')}, ${seconds} s${track ? ` on "${track.title}" (${Math.round(bpm)} BPM)` : ''}`);
    const out = join(work, 'ad.mp4');
    await renderReel(file, o.size, out, { workers: 2, audio: wav });
    const mp4 = readFileSync(out);
    if (mp4.length < 60_000) throw new Error('the render came out empty');
    const shot = await reelStills(file, o.size, 'states').catch(() => ({ stills: [] as { png: Buffer }[] }));
    const stills = await Promise.all(shot.stills.map((s) => ffmpeg({ 'in.png': s.png }, (f, p) => ['-i', f['in.png'], '-vf', 'scale=432:-1', '-q:v', '5', p], 'jpg')));
    return { mp4, seconds, track, music: music?.label, stills };
  } finally { rmSync(work, { recursive: true, force: true }); }
}

/** A 1:1 cut of a vertical video for the feed: the whole frame (hook at the top, call to action at the bottom) on a
 *  blurred, darkened fill of itself, so nothing is cropped. */
export const squareOf = (vertical: Buffer) => ffmpeg({ 'v.mp4': vertical }, (f, out) => ['-i', f['v.mp4'], '-filter_complex', '[0:v]split[a][b];[a]scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080,boxblur=24:2,eq=brightness=-0.08[bg];[b]scale=-2:1080[fg];[bg][fg]overlay=(W-w)/2:0,format=yuv420p[v]', '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out]);
