// Tempo, beat grid and a good starting bar for a music track, so a motion ad can cut on its beat.
// node src/beats.ts track.mp3 [...more]  → JSON per track: { bpm, firstBeat, start, conf }
// Onsets: frame energy rise of the high-passed signal (snares, hats) plus the low band (kicks), 23 ms hops.
// Tempo: autocorrelation of the onset curve over 70-180 BPM, weighted towards 90-130 (ad tempos), checked on two
// halves of the track. Phase: the beat grid offset that lands on the most onsets; the downbeat is the grid phase
// with the most low-band energy. Start: the first downbeat where the track is at full strength (intros skipped).
import { execFileSync } from 'node:child_process';
import { FFMPEG } from './media.ts';

const SR = 22050, HOP = 256, FPS = SR / HOP;

function decode(file: string, seconds = 90, from = 0): Float32Array {
  const buf = execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-ss', String(from), '-i', file, '-t', String(seconds), '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
}

export function analyse(file: string, o: { from?: number; seconds?: number } = {}) {
  const x = decode(file, o.seconds ?? 90, o.from ?? 0);
  const n = Math.floor(x.length / HOP);
  const hi = new Float32Array(n), lo = new Float32Array(n), rms = new Float32Array(n);
  let lp = 0;
  for (let f = 0; f < n; f++) {
    let eh = 0, el = 0, e = 0;
    for (let i = f * HOP; i < (f + 1) * HOP; i++) {
      const d = x[i] - (x[i - 1] ?? 0); eh += d * d;
      lp += 0.02 * (x[i] - lp); el += lp * lp; e += x[i] * x[i];
    }
    hi[f] = Math.log(1e-9 + eh); lo[f] = Math.log(1e-9 + el); rms[f] = Math.sqrt(e / HOP);
  }
  const flux = (a: Float32Array) => { const o = new Float32Array(n); for (let f = 1; f < n; f++) o[f] = Math.max(0, a[f] - a[f - 1]); return o; };
  const oh = flux(hi), ol = flux(lo);
  const on = new Float32Array(n); for (let f = 0; f < n; f++) on[f] = oh[f] + 1.4 * ol[f];
  // remove the slow trend so autocorrelation sees the pulse
  const mean = on.reduce((a, b) => a + b, 0) / n; for (let f = 0; f < n; f++) on[f] -= mean;

  const tempoOf = (a0: number, a1: number) => {
    let best = 0, bestLag = 0;
    const score: number[] = [];
    for (let lag = Math.floor((60 / 180) * FPS); lag <= Math.ceil((60 / 70) * FPS); lag++) {
      let s = 0; for (let f = a0; f + lag < a1; f++) s += on[f] * on[f + lag];
      const bpm = (60 * FPS) / lag, w = Math.exp(-0.5 * (Math.log2(bpm / 112) / 0.55) ** 2);
      score[lag] = s; if (s * w > best) { best = s * w; bestLag = lag; }
    }
    // parabolic refinement around the best lag
    const y0 = score[bestLag - 1] ?? 0, y1 = score[bestLag], y2 = score[bestLag + 1] ?? 0;
    const lag = bestLag + (y0 - y2) / (2 * (y0 - 2 * y1 + y2) || 1) * 0.5;
    return (60 * FPS) / lag;
  };
  const bpmA = tempoOf(0, n >> 1), bpmB = tempoOf(n >> 1, n), bpmAll = tempoOf(0, n);
  const agree = Math.abs(bpmA - bpmB) / bpmAll < 0.03;
  const bpm = Math.round(bpmAll * 10) / 10;
  const P = (60 / bpm) * FPS; // frames per beat

  // beat phase: the offset whose grid collects the most kick (low band) and, less, the most attack overall;
  // hats often sit between beats, so the kick decides. A 3-frame window tolerates small timing swing.
  const at = (a: Float32Array, t: number) => { const i = Math.round(t); return Math.max(a[i] ?? 0, 0.6 * (a[i - 1] ?? 0), 0.6 * (a[i + 1] ?? 0)); };
  let bestPh = 0, bestS = -Infinity;
  for (let ph = 0; ph < P; ph += 0.25) { let s = 0; for (let t = ph; t < n; t += P) s += at(ol, t) + 0.35 * Math.max(0, at(oh, t)); if (s > bestS) { bestS = s; bestPh = ph; } }
  // how clearly the grid stands out: its onset sum against the average of all other phases
  let others = 0, cnt = 0;
  for (let ph = 0; ph < P; ph += 0.25) { if (Math.abs(ph - bestPh) < 3 || Math.abs(ph - bestPh) > P - 3) continue; let s = 0; for (let t = ph; t < n; t += P) s += at(ol, t) + 0.35 * Math.max(0, at(oh, t)); others += s; cnt++; }
  const contrast = Math.round((bestS / (others / cnt)) * 100) / 100;
  // downbeat: which of the four beats carries the most kick
  let down = 0, downS = -Infinity;
  for (let k = 0; k < 4; k++) { let s = 0; for (let t = bestPh + k * P; t < n; t += 4 * P) s += ol[Math.round(t)] ?? 0; if (s > downS) { downS = s; down = k; } }
  const firstBeat = (bestPh + down * P) / FPS;

  // start: the first downbeat where a 2 s window is at 80% of the track's typical loudness
  const win = Math.round(2 * FPS), level: number[] = [];
  for (let f = 0; f + win < n; f += 4) { let e = 0; for (let i = f; i < f + win; i++) e += rms[i]; level.push(e / win); }
  const typical = [...level].sort((a, b) => a - b)[Math.floor(level.length * 0.6)];
  const bar = (4 * 60) / bpm;
  let start = firstBeat;
  for (let t = firstBeat; t < 40; t += bar) { const i = Math.floor((t * FPS) / 4); if ((level[i] ?? 0) >= 0.8 * typical) { start = t; break; } }

  // confidence: how much of the onset energy sits on the grid
  let on1 = 0, all = 0; for (let f = 0; f < n; f++) { const v = Math.max(0, on[f]); all += v; const d = ((f - bestPh) % P + P) % P; if (d < 1.2 || P - d < 1.2) on1 += v; }
  return { bpm, firstBeat: Math.round(firstBeat * 1000) / 1000, start: Math.round(start * 1000) / 1000, halvesAgree: agree, bpmHalves: [Math.round(bpmA * 10) / 10, Math.round(bpmB * 10) / 10], onGrid: Math.round((on1 / all) * 100) / 100, contrast };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const f of process.argv.slice(2)) console.log(JSON.stringify({ file: f.split('/').pop(), ...analyse(f) }));
}
