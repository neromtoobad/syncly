import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { OfficeScene, OfficeEvent } from './scene.ts';

type StatsApi = { toolCalls: number; settled: number; delivered: number };

export type FeedItem = { at: string; kind: 'live' | 'replay'; e: OfficeEvent };
type Props = {
  orderId?: string; // job page: only this order's events
  team?: string[]; // dim everyone else
  idleReplayMs?: number; // start replaying recorded events after this much silence (0 = never auto)
  onFeed?: (f: FeedItem) => void;
  onMode?: (m: { mode: 'live' | 'replay' | 'idle'; orderId?: string }) => void;
  replayToken?: number; // bump to force a replay (e.g. "Replay this job")
  controls?: boolean; // show director / sound buttons over the stage
  onAgentClick?: (id: string) => void;
  fill?: boolean; // fill the parent (the /live stage) instead of a 16:9 box
  fullLink?: boolean; // show a button that opens the office on its own (/live)
  soundOnFirstClick?: boolean; // the /live stage: the first click anywhere turns the music on
  onSound?: (on: boolean) => void;
  backlog?: OfficeEvent[]; // job page: what already happened on a live job, played quickly once the office has loaded
  working?: string[] | null; // job page: the team on a live job keeps working between events
  directorOnStart?: boolean; // start with the camera following the action
};
const evKey = (e: OfficeEvent) => `${e.type}:${e.data?.at ?? e.at ?? ''}:${e.data?.step ?? e.data?.transaction ?? e.data?.status ?? ''}`;

const wait = (ms: number, signal: { stop: boolean }) => new Promise<void>((r) => { const t = setInterval(() => { if (signal.stop) { clearInterval(t); r(); } }, 100); setTimeout(() => { clearInterval(t); r(); }, ms); });

export default function Office({ orderId, team, idleReplayMs = 12000, onFeed, onMode, replayToken, controls = true, onAgentClick, fill = false, fullLink = !fill, soundOnFirstClick = false, onSound, backlog, working, directorOnStart = false }: Props) {
  const [director, setDirector] = useState(directorOnStart); // the whole building by default; Director follows the action
  const backlogRef = useRef(backlog);
  backlogRef.current = backlog;
  const catching = useRef<OfficeEvent[] | null>(null); // live events that arrive while the office catches up
  const [sound, setSound] = useState(false);
  const el = useRef<HTMLDivElement>(null);
  const scene = useRef<OfficeScene | null>(null);
  const [ready, setReady] = useState(false);
  const lastLive = useRef(0);
  const replaying = useRef<{ stop: boolean } | null>(null);
  const cb = useRef({ onFeed, onMode, onAgentClick, onSound });
  cb.current = { onFeed, onMode, onAgentClick, onSound };
  const setSoundOn = (v: boolean) => { setSound(v); scene.current?.setSound(v); cb.current.onSound?.(v); };

  // browsers only allow audio after a click: on the /live stage, the first click anywhere starts the music
  useEffect(() => {
    if (!ready || !soundOnFirstClick) return;
    const go = () => { setSoundOn(true); window.removeEventListener('pointerdown', go); window.removeEventListener('keydown', go); };
    window.addEventListener('pointerdown', go); window.addEventListener('keydown', go);
    return () => { window.removeEventListener('pointerdown', go); window.removeEventListener('keydown', go); };
  }, [ready, soundOnFirstClick]);

  // mount the scene
  useEffect(() => {
    let s: OfficeScene | null = null, cancelled = false;
    import('./scene.ts').then((m) => (cancelled || !el.current ? null : m.OfficeScene.create(el.current))).then((x) => { if (!x) return; if (cancelled) x.destroy(); else { s = scene.current = x; setReady(true); if (process.env.NODE_ENV !== 'production') (window as any).__office = x; } });
    return () => { cancelled = true; replaying.current && (replaying.current.stop = true); s?.destroy(); scene.current = null; };
  }, []);
  useEffect(() => { if (ready) scene.current?.focus(team ?? null); }, [ready, team?.join(',')]);
  useEffect(() => { if (ready) scene.current?.setWorking(working ?? null); }, [ready, working?.join(',')]);
  useEffect(() => { if (ready && directorOnStart) scene.current?.setDirector(true); }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready && scene.current) scene.current.onAgentClick = (id) => cb.current.onAgentClick?.(id); }, [ready]);

  // the wall screen in the office shows the team's real work
  useEffect(() => {
    if (!ready) return;
    const load = () => fetch('/api/stats').then((r) => r.json()).then((s: StatsApi) => scene.current?.setStats({ jobs: s.delivered, calls: s.toolCalls, settled: s.settled })).catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [ready]);

  // live events
  useEffect(() => {
    if (!ready) return;
    const es = new EventSource(orderId ? `/api/events?order=${orderId}` : '/api/events');
    // A live job's office loads a few seconds after the job starts: play what it missed (the brief arriving,
    // then the latest steps) quickly, holding new events until it has caught up.
    const missed = backlogRef.current ?? [];
    const sig = { stop: false };
    if (missed.length) {
      catching.current = [];
      (async () => {
        const seen = new Set(missed.map(evKey));
        const [first, ...rest] = missed;
        if (first.type === 'order') { scene.current?.handle(first); await wait(5200, sig); } else rest.unshift(first);
        for (const e of rest.slice(-6)) { if (sig.stop) return; scene.current?.handle(e); cb.current.onFeed?.({ at: e.at ?? '', kind: 'live', e }); await wait(900, sig); }
        const held = catching.current ?? [];
        catching.current = null;
        for (const e of held) if (!seen.has(evKey(e))) scene.current?.handle(e);
      })();
    }
    const onEvent = (msg: MessageEvent) => {
      const e = JSON.parse(msg.data) as OfficeEvent;
      if (!e.type) return;
      if (catching.current) { catching.current.push(e); return; }
      if (replaying.current) { replaying.current.stop = true; replaying.current = null; }
      lastLive.current = Date.now();
      scene.current?.handle(e);
      cb.current.onFeed?.({ at: e.at ?? new Date().toISOString(), kind: 'live', e });
      cb.current.onMode?.({ mode: 'live', orderId: e.orderId });
    };
    for (const t of ['step', 'purchase', 'order']) es.addEventListener(t, onEvent);
    return () => { sig.stop = true; catching.current = null; es.close(); };
  }, [ready, orderId]);

  // replay recorded events when idle (or on demand)
  async function playReplay(signal: { stop: boolean }) {
    const r = await fetch(`/api/replay?limit=5${orderId ? `&order=${orderId}` : ''}`).then((x) => x.json()).catch(() => null);
    const orders: { id: string; events: OfficeEvent[] }[] = r?.orders ?? [];
    if (!orders.length) { cb.current.onMode?.({ mode: 'idle' }); return; }
    for (const o of [...orders].reverse()) {
      if (signal.stop) return;
      cb.current.onMode?.({ mode: 'replay', orderId: o.id });
      let prev = 0;
      for (const e of o.events) {
        if (signal.stop) return;
        const t = Date.parse(e.at ?? '');
        const gap = prev ? Math.min(1400, Math.max(260, (t - prev) / 3)) : 300;
        prev = t;
        await wait(gap, signal);
        if (signal.stop) return;
        scene.current?.handle(e);
        cb.current.onFeed?.({ at: e.at ?? '', kind: 'replay', e });
      }
      await wait(3500, signal);
    }
  }
  useEffect(() => {
    if (!ready) return;
    const tick = setInterval(() => {
      if (!idleReplayMs || replaying.current) return;
      if (Date.now() - lastLive.current < idleReplayMs) return;
      const sig = { stop: false };
      replaying.current = sig;
      playReplay(sig).finally(() => { if (replaying.current === sig) { replaying.current = null; lastLive.current = Date.now() - idleReplayMs + 8000; } });
    }, 1000);
    lastLive.current = Date.now() - idleReplayMs + 2500; // first replay starts ~2.5 s after load if nothing is live
    return () => clearInterval(tick);
  }, [ready, idleReplayMs, orderId]);
  useEffect(() => {
    if (!ready || !replayToken) return;
    replaying.current && (replaying.current.stop = true);
    const sig = { stop: false };
    replaying.current = sig;
    playReplay(sig).finally(() => { if (replaying.current === sig) replaying.current = null; });
  }, [replayToken]);

  return (
    <div className={`office-wrap${fill ? ' fill' : ''}`}>
      <div ref={el} className="office-canvas" />
      {!ready && <div className="office-loading"><span className="dot pulse" />Opening the office…</div>}
      {controls && ready && (
        <div className="office-controls">
          <button className={director ? 'on' : ''} onClick={() => { const v = !director; setDirector(v); scene.current?.setDirector(v); }} title="The camera follows the action">{director ? '● Director' : '○ Director'}</button>
          <button className={director ? '' : 'on'} onClick={() => { setDirector(false); scene.current?.setDirector(false); }} title="See the whole building">Wide</button>
          <button className={sound ? 'on' : ''} onPointerDown={(e) => e.stopPropagation()} onClick={() => setSoundOn(!sound)} title="Marimba soundtrack and sound effects">{sound ? '♪ Marimba on' : '♪ Marimba off'}</button>
          {fullLink && <Link href="/live" className="office-full" title="Just the office, full screen">⤢ Office only</Link>}
        </div>
      )}
    </div>
  );
}
