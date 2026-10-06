// Licensed background music for Motion Ad: 15 tracks from Mixkit (mixkit.co), all under the Mixkit Stock Music Free
// License: free for commercial use on the web and social media, including online ads, with no attribution and no
// Content ID registration; not for TV or radio broadcast, CDs, DVDs or video games, and not to be remixed into a
// music-only track or registered with a rights service. We don't keep the files in the repo (that would be handing
// them out on their own): the server fetches a track from Mixkit the first time it's needed and caches it privately.
//
// Each track was measured with src/beats.ts: its tempo and where it reaches full strength (`start`, so intros are
// skipped). The exact downbeat near `start` is measured on first use (trackGrid); an ad starts its music there and
// cuts every scene on the track's beat. Tracks whose grid didn't re-measure within a tenth of a beat were left out.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DATA_DIR } from './config.ts';
import { FFMPEG, download } from './media.ts';
import { analyse } from './beats.ts';

export type Track = { id: number; title: string; author: string; bpm: number; start: number; mood: string };
export const MUSIC_LICENSE = 'Mixkit Stock Music Free License (mixkit.co/license): free for web and social media use, including online ads; not for TV or radio broadcast.';

export const TRACKS: Track[] = [
  { id: 1077, title: 'Sounds Good', author: 'Michael Ramir C.', bpm: 120.1, start: 0.849, mood: 'funk playful confident lively fun' },
  { id: 1084, title: "Let's Play Africa", author: 'Michael Ramir C.', bpm: 114.8, start: 0.012, mood: 'african warm playful food festive happy' },
  { id: 1140, title: 'Funkee Monkeee', author: 'Michael Ramir C.', bpm: 120.1, start: 8.059, mood: 'funk playful fun lively young' },
  { id: 1167, title: 'Close Up', author: 'Michael Ramir C.', bpm: 105.3, start: 0.064, mood: 'corporate clean calm professional modern' },
  { id: 130, title: 'Tech House vibes', author: 'Alejandro Magaña (A. M.)', bpm: 122.8, start: 15.682, mood: 'modern tech energetic night power' },
  { id: 175, title: 'Digital Clouds', author: 'Alejandro Magaña (A. M.)', bpm: 129.2, start: 0.203, mood: 'calm tech modern premium clean' },
  { id: 33, title: 'Motivating Mornings', author: 'Ahjay Stelino', bpm: 120.5, start: 13.259, mood: 'bright fresh hopeful friendly warm' },
  { id: 34, title: 'Raising Me Higher', author: 'Ahjay Stelino', bpm: 110, start: 2.738, mood: 'hopeful inspiring warm friendly' },
  { id: 371, title: 'Cat Walk', author: 'Arulo', bpm: 129.3, start: 17.732, mood: 'fashion beauty cool premium elegant' },
  { id: 474, title: 'What About Action?', author: 'Diego Nava', bpm: 120.5, start: 17.18, mood: 'energetic bold sports power fast' },
  { id: 5, title: 'Feeling Happy', author: 'Ahjay Stelino', bpm: 107.4, start: 0.588, mood: 'happy warm playful food cheer' },
  { id: 51, title: 'Sports Highlights', author: 'Ahjay Stelino', bpm: 125.7, start: 0.052, mood: 'energetic sports bold fitness fast' },
  { id: 623, title: 'Deep Urban', author: 'Eugenio Mininni', bpm: 123.3, start: 16.111, mood: 'cool premium urban modern night' },
  { id: 738, title: 'Hip Hop 02', author: 'Lily J', bpm: 97.4, start: 1.68, mood: 'street young bold fashion cool' },
  { id: 872, title: 'Gimme that Groove!', author: 'Michael Ramir C.', bpm: 112.3, start: 8.659, mood: 'funk playful lively food festive' },
];

const DIR = () => { const d = join(DATA_DIR, 'music'); mkdirSync(d, { recursive: true }); return d; };
const url = (t: Track) => `https://assets.mixkit.co/music/${t.id}/${t.id}.mp3`;
export const trackPage = (t: Track) => `https://mixkit.co/free-stock-music/?q=${encodeURIComponent(t.title)}`;

/** The track's file, fetched from Mixkit once and kept in the private data volume. */
export async function trackFile(t: Track): Promise<string> {
  const f = join(DIR(), `${t.id}.mp3`);
  if (existsSync(f)) return f;
  const buf = await download(url(t), 20);
  if (buf.length < 200_000) throw new Error(`the track ${t.title} came back too small`);
  writeFileSync(f, buf);
  return f;
}

/** The beat grid of the part of the track an ad uses: its tempo there and the exact downbeat to start on. Measured
 *  on that stretch itself (kick-weighted, 11 ms resolution) the first time, then kept next to the file. */
export async function trackGrid(t: Track): Promise<{ bpm: number; start: number }> {
  const f = join(DIR(), `${t.id}.grid.json`);
  try { if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8')); } catch { /* measure again */ }
  const file = await trackFile(t);
  const from = Math.max(0, t.start - 0.25);
  const a = analyse(file, { from, seconds: 40 });
  const bpm = Math.abs(a.bpm / t.bpm - 1) < 0.06 ? a.bpm : t.bpm; // a stray reading (half or double time) keeps the measured tempo
  const g = { bpm, start: Math.round((from + a.firstBeat) * 1000) / 1000 };
  writeFileSync(f, JSON.stringify(g));
  return g;
}

/** A track for this ad: suited to the mood when one fits, never one of the last five used. `tempo` limits the
 *  choice to tracks within 8% of it (for engines with a fixed beat). */
export function pickTrack(mood = '', tempo?: number): Track {
  const f = join(DIR(), 'recent.json');
  let recent: number[] = [];
  try { if (existsSync(f)) recent = JSON.parse(readFileSync(f, 'utf8')); } catch { /* start fresh */ }
  let pool = TRACKS.filter((t) => !tempo || Math.abs(t.bpm / tempo - 1) <= 0.08);
  const fresh = pool.filter((t) => !recent.slice(-5).includes(t.id));
  if (fresh.length) pool = fresh;
  const words = mood.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2);
  const weighted = pool.flatMap((t) => { const hits = words.filter((w) => t.mood.includes(w)).length; return Array(1 + hits * 2).fill(t); });
  const t = weighted[Math.floor(Math.random() * weighted.length)];
  try { writeFileSync(f, JSON.stringify([...recent, t.id].slice(-12))); } catch { /* not remembering is fine */ }
  return t;
}

/** The ad's soundtrack: the track from its first full-strength downbeat (stretched to `tempo` if given), faded in
 *  and out, with the scene's own whooshes and impacts underneath. Returns a 48 kHz stereo WAV. */
export async function trackAudio(t: Track, seconds: number, o: { tempo?: number; sfx?: Buffer } = {}): Promise<Buffer> {
  const file = await trackFile(t);
  const grid = await trackGrid(t);
  const tmp = join(DIR(), `mix-${process.pid}-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  try {
    const out = join(tmp, 'out.wav'), sfx = join(tmp, 'sfx.wav');
    const ratio = o.tempo ? o.tempo / grid.bpm : 1;
    const fadeOut = Math.min(1.6, seconds / 6);
    const music = `[0:a]aresample=48000,${ratio !== 1 ? `atempo=${ratio.toFixed(5)},` : ''}atrim=0:${seconds.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=0.04,afade=t=out:st=${(seconds - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}[m]`;
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(grid.start), '-i', file];
    let graph = music;
    if (o.sfx) {
      writeFileSync(sfx, o.sfx);
      args.push('-i', sfx);
      // the scene's sound design sits well under the song: felt on the cuts, never over the music
      graph += `;[1:a]aresample=48000,volume=0.22,atrim=0:${seconds.toFixed(3)}[s];[m][s]amix=inputs=2:duration=first:normalize=0[a]`;
    } else graph += ';[m]anull[a]';
    args.push('-filter_complex', graph, '-map', '[a]', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', out);
    await promisify(execFile)(FFMPEG, args, { maxBuffer: 1 << 24, timeout: 120_000 });
    return readFileSync(out);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
