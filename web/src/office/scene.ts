// Syncly HQ: a three-storey building in cutaway, driven only by real events (SSE from the API, or a
// labelled replay of recorded ones). Nothing is simulated: an agent types because it just took a step,
// a coin flies because a purchase was just paid, the Messenger walks out of the door because a job was
// just delivered. PixiJS draws; GSAP choreographs; an auto-director moves the camera to the action.
import * as PIXI from 'pixi.js';
import { gsap } from 'gsap';
import { Sound } from './music.ts';

export type OfficeEvent = { type: 'step' | 'purchase' | 'order'; orderId?: string; jobId?: string; at?: string; data: any };
export type Stats = { jobs: number; calls: number; settled: number };
type P = { x: number; y: number };

// ------------------------------------------------------------------ the building (4K art coordinates)
const WW = 3840, WH = 2160;
const LANE = { top: 915, mid: 1500, ground: 2045 } as const;
type Floor = keyof typeof LANE;
const DESK = { top: 1344, bottom: 1478, back: 1442 };
const DESK_X = [947, 1149, 1350, 1551, 1758, 1970, 2171, 2374, 2573, 2778];
const DESK_EDGE: [number, number][] = [[850, 1044], [1056, 1242], [1258, 1442], [1461, 1642], [1666, 1850], [1880, 2060], [2079, 2264], [2282, 2467], [2479, 2667], [2677, 2879]];
const LAPTOP_X = [955, 1154, 1354, 1554, 1761, 1968, 2169, 2372, 2571, 2770];
const SEATS = ['scout', 'researcher', 'reader', 'writer', 'investigator', 'analyst', 'auditor', 'illustrator', 'producer', 'messenger'];
// Retired roles (old jobs still replay) and roles without a character yet work from a colleague's desk.
const SHARES: Record<string, string> = { verifier: 'investigator', mailer: 'messenger', bookkeeper: 'analyst', linguist: 'writer' };
const ROW_END = 2935; // walk behind the desks to here, then step forward onto the lane
const CFO_SPOT = { x: 2518, y: 885 };
const CFO_DESK = { x0: 2302, x1: 2798, top: 762, bottom: 909 };
const TABLE = { x0: 752, x1: 1669, top: 764, bottom: 900 };
const TABLE_SPOTS = [932, 1059, 1198, 1340, 1480, 1609];
const WHITEBOARD = { x0: 862, y0: 516, x1: 1648, y1: 732 };
const SCREEN = { x0: 1520, y0: 1080, x1: 2140, y1: 1274 };
const VAULT = { x: 2377, y: 661, r: 221 };
const RECEPTION = { x0: 917, x1: 1530, top: 1812, bottom: 1968 };
const COUNTER = { x0: 2070, x1: 2576, top: 1841, bottom: 2025 };
const SHELVES = { x0: 1976, x1: 2682, y0: 1623, y1: 1841 };
const COFFEE = { x0: 2765, x1: 3079, top: 1819, bottom: 2033 };
const DOOR = { x0: 560, x1: 757, y0: 1613, y1: 2002, cx: 660 };
const SIGN = { x0: 1370, y0: 80, x1: 2464, y1: 274 };
const LIFT = { x: 3390, x0: 3292, x1: 3488 };
// where people wait for the lift (a little apart, so two waiting people do not overlap)
const LIFT_WAIT: Record<string, number> = { messenger: 3205, auditor: 3150, cfo: 3150 };
const liftWait = (id: string) => LIFT_WAIT[id] ?? 3180;
const LAMPS = [984, 1324, 1650, 2034, 2360, 2686];

const STAND = 0.9, BEHIND = 0.86, SEATED = 0.72, CFO_SCALE = 0.9;
const SEAT_Y = DESK.top + 22; // seated sprites are drawn behind the desk; the desk front hides the rest
const SPEED = 330; // world units / second: a brisk walk for a ~316-unit-tall person
const STEP = 128; // ground covered by one step of a ~316-unit-tall person; cycles advance by distance so feet do not slide
const CYCLE_STEPS: Record<string, number> = { 'messenger-carry': 4 }; // steps drawn in each 8-frame sheet (default 2)
const WF = { idle: 0, walkA: 1, walkB: 2, type: 3, cheer: 4, sad: 5, box: 6, coin: 7 };
const CF = { idle: 0, walkA: 1, walkB: 2, talk: 3, stamp: 4, stern: 5, thumbs: 6, deny: 7 };
const SERVICE: Record<string, string> = { website: 'Business Website', 'content-pack': 'Social Media Posts', 'motion-ad': 'Promo Video', 'ad-launch': 'Ad Campaign', 'product-photos': 'Product Photos', 'get-found': 'Google Visibility Check', 'buy-smart': 'Best Price & Seller Check', 'video-ad': 'Video Ad', 'ai-answer-audit': 'AI Answer Audit', 'best-price': 'Best Price Finder', 'vendor-check': 'Check Before You Pay', 'research-brief': 'Market Research', 'find-customers': 'Find Customers', 'money-report': 'Money Report', 'flyers': 'Flyers & Price Lists', 'local-business-finder': 'Local Business Finder', 'lead-list': 'Lead List' };
const NAME: Record<string, string> = { cfo: 'The CFO', scout: 'Scout', researcher: 'Researcher', writer: 'Writer', illustrator: 'Designer', verifier: 'Verifier', mailer: 'Mailer', reader: 'Reader', analyst: 'Analyst', messenger: 'Messenger', auditor: 'Auditor', producer: 'Producer', investigator: 'Investigator' };
const COLOR: Record<string, number> = { cfo: 0x17473b, scout: 0xd9a21b, researcher: 0x7a2335, writer: 0xe1705c, illustrator: 0x8f79c9, verifier: 0x5f97d1, mailer: 0xec7418, reader: 0x556b2f, analyst: 0x2848b8, messenger: 0xcf2a2a, auditor: 0x5a2d5f, producer: 0xc2187a, investigator: 0x8a6232 };

// Camera shots: centre + visible width in world units (height follows the 16:9 canvas).
const SHOTS = {
  wide: { cx: 1920, cy: 1080, w: 3840 },
  cfo: { cx: 2560, cy: 650, w: 1500 },
  meeting: { cx: 1180, cy: 650, w: 1560 },
  work: { cx: 1860, cy: 1420, w: 2750 },
  door: { cx: 1100, cy: 1780, w: 1900 },
  vault: { cx: 2420, cy: 690, w: 1400 },
} as const;
type ShotName = keyof typeof SHOTS;

const css = (v: string, fb: string) => (typeof document !== 'undefined' && getComputedStyle(document.documentElement).getPropertyValue(v).trim()) || fb;

type Frames = { meta: any; tex: PIXI.Texture[] };
/** A character's frames: one packed WebP per character (tools/sprites/atlas.mjs), or the single PNGs if there is no atlas. */
const atlasOf = (id: string) => fetch(`/sprites/${id}/${id}.atlas.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
async function loadTextures(id: string, meta: any, atlas: any): Promise<PIXI.Texture[]> {
  if (atlas) {
    const sheet: PIXI.Texture = await PIXI.Assets.load(`/sprites/${id}/${atlas.image}`);
    return atlas.rects.map(([x, y, w, h]: number[]) => new PIXI.Texture({ source: sheet.source, frame: new PIXI.Rectangle(x, y, w, h) }));
  }
  return Promise.all(meta.frames.map((f: any) => PIXI.Assets.load(`/sprites/${id}/${f.file}`)));
}
async function loadFrames(id: string): Promise<Frames> {
  const [meta, atlas] = await Promise.all([fetch(`/sprites/${id}/${id}.json`).then((r) => r.json()), atlasOf(id)]);
  return { meta, tex: await loadTextures(id, meta, atlas) };
}
/** A side-view walk cycle (frames face RIGHT), scaled to the character's standing height. */
type Cycle = { tex: PIXI.Texture[]; anchorX: number; k: number; dist: number };
const bboxH = (f: any) => f.bbox[3] - f.bbox[1];
// The walk and carry sheets that exist; everyone else walks with their pose frames (no request for a missing sheet).
const CYCLE_SHEETS = new Set(['cfo-walk', 'auditor-walk', 'messenger-walk', 'messenger-carry']);
async function loadCycle(id: string, base: Frames): Promise<Cycle | undefined> {
  if (!CYCLE_SHEETS.has(id)) return undefined;
  try {
    const [r, atlas] = await Promise.all([fetch(`/sprites/${id}/${id}.json`), atlasOf(id)]); if (!r.ok) return undefined;
    const meta = await r.json();
    const tex = await loadTextures(id, meta, atlas);
    const hc = meta.frames.reduce((a: number, f: any) => a + bboxH(f), 0) / meta.frames.length;
    return { tex, anchorX: meta.anchor.x, k: bboxH(base.meta.frames[0]) / hc, dist: STEP * (CYCLE_STEPS[id] ?? 2) };
  } catch { return undefined; }
}

// ------------------------------------------------------------------ an agent
class Actor {
  root = new PIXI.Container();
  sprite: PIXI.Sprite;
  shadow = new PIXI.Graphics().ellipse(0, 0, 58, 13).fill({ color: 0x1a0f05, alpha: 0.28 });
  pos: P;
  scale: number;
  facing = 1;
  frame = 0;
  mode: 'seat' | 'behind' | 'stand' | 'walk' | 'carry' | 'carryStand' = 'stand';
  cycles: { walk?: Cycle; carry?: Cycle } = {};
  private shown: PIXI.Texture | null = null;
  hold: number | null = null; // pose override frame
  walked = 0;
  busyUntil = 0;
  queue: Promise<void> = Promise.resolve();
  last = '';
  home: { x: number; laptop: number } | null = null;
  constructor(public id: string, public c: Frames, public F: Record<string, number>, x: number, y: number, scale: number) {
    this.sprite = new PIXI.Sprite(c.tex[0]);
    this.sprite.anchor.set(c.meta.anchor.x, 1);
    this.root.addChild(this.shadow, this.sprite);
    this.pos = { x, y };
    this.scale = scale;
    this.root.eventMode = 'static';
    this.root.cursor = 'pointer';
  }
  get busy() { return performance.now() < this.busyUntil; }
  then(fn: () => Promise<void> | void) { this.queue = this.queue.then(fn).catch(() => {}); return this.queue; }
  update(t: number) {
    const F = this.F;
    let frame = F.idle, dy = 0, sy = 1, sx = 1, rot = 0;
    let cyc: Cycle | undefined, cf = 0;
    const ph = this.pos.x * 0.013;
    switch (this.mode) {
      case 'seat':
        frame = F.type ?? F.idle;
        if (this.busy) dy = Math.sin(t * 9 + ph) > 0.55 ? -2.5 : 0; else sy = 1 + 0.008 * Math.sin(t * 1.6 + ph);
        break;
      case 'walk': case 'carry': {
        cyc = this.mode === 'carry' ? this.cycles.carry : this.cycles.walk;
        if (cyc) {
          // side-view cycle: the frame is picked by distance walked, so each step lands where the foot is
          cf = Math.floor((this.walked / cyc.dist) * cyc.tex.length) % cyc.tex.length;
        } else {
          // no side-view art: a four-beat stride (step, pass, step, pass) with a bob on each step
          const beat = Math.floor(this.walked / 62) % 4;
          frame = this.mode === 'carry' ? F.box : [F.walkA, F.idle, F.walkB, F.idle][beat];
          dy = -Math.abs(Math.sin((this.walked / 62) * (Math.PI / 2))) * 6;
          rot = this.mode === 'carry' ? 0.025 * Math.sin((this.walked / 62) * Math.PI) : 0;
        }
        break;
      }
      case 'carryStand':
        cyc = this.cycles.carry; cf = 1; // the passing pose: feet together, box held
        if (!cyc) frame = F.box;
        sy = 1 + 0.008 * Math.sin(t * 1.6 + ph);
        break;
      default: sy = 1 + 0.01 * Math.sin(t * 1.4 + ph);
    }
    if (this.hold != null) frame = this.hold;
    if (this.hold === F.cheer) { const hop = Math.abs(Math.sin(t * 7 + ph)); dy = -hop * 22; sy = 1 + hop * 0.05; sx = 1 - hop * 0.03; }
    if (this.hold === F.sad) sy = 1 - 0.015 * Math.sin(t * 2 + ph);
    if (this.id === 'cfo' && this.hold === F.deny) rot = 0.05 * Math.sin(t * 20);
    let k = 1, dir = this.facing;
    const tex = cyc && this.hold == null ? cyc.tex[cf] : this.c.tex[frame];
    if (cyc && this.hold == null) { k = cyc.k; dir = -this.facing; } // cycles face right; base art faces left
    if (tex !== this.shown) { this.shown = tex; this.frame = frame; this.sprite.texture = tex; this.sprite.anchor.set(cyc && this.hold == null ? cyc.anchorX : this.c.meta.anchor.x, 1); }
    this.sprite.scale.set(this.scale * k * sx * dir, this.scale * k * sy);
    this.sprite.y = dy;
    this.sprite.rotation = rot;
    this.shadow.visible = this.mode !== 'seat' && this.mode !== 'behind';
    this.shadow.scale.set(this.scale / STAND);
    this.root.position.set(this.pos.x, this.pos.y);
  }
}

// ------------------------------------------------------------------ the scene
export class OfficeScene {
  app = new PIXI.Application();
  private el!: HTMLElement;
  private world = new PIXI.Container();
  private under = new PIXI.Container(); // wall content + lamp light (behind people)
  private seats = new PIXI.Container(); // people behind desks / tables
  private occ = new PIXI.Container(); // desk fronts, counters: cut from the art itself
  private lane = new PIXI.Container(); // people walking at the front + the lift
  private fx = new PIXI.Container();
  private hud = new PIXI.Container(); // screen-space: bubbles, labels
  private actors = new Map<string, Actor>();
  private bubbles = new Map<string, { c: PIXI.Container; until: number; a: Actor }>();
  private floats: { c: PIXI.Container; w: P; t0: number }[] = [];
  private bgTex!: PIXI.Texture;
  private lift = { y: LANE.ground as number, back: new PIXI.Graphics(), front: new PIXI.Graphics(), busy: Promise.resolve() as Promise<void> };
  private cam: { cx: number; cy: number; w: number } = { cx: SHOTS.wide.cx, cy: SHOTS.wide.cy, w: SHOTS.wide.w };
  private shake = 0;
  private dir = { on: false, lockUntil: 0, current: 'wide' as ShotName | 'follow', follow: null as Actor | null, lastEvent: 0, pending: [] as { shot: ShotName; hold: number }[] };
  private tweens = new Set<gsap.core.Animation>();
  private screen!: { rev: PIXI.Text; sub: PIXI.Text; tick: PIXI.Text; clock: PIXI.Text; value: { rev: number } };
  private board!: { title: PIXI.Text; body: PIXI.Text; team: PIXI.Text; c: PIXI.Container };
  private sign!: PIXI.Sprite;
  private shelfGlow!: PIXI.Graphics;
  private laptopGlow = new Map<string, PIXI.Sprite>();
  private vaultWheel!: PIXI.Sprite;
  private fonts = { sans: 'Inter, sans-serif', serif: 'Georgia, serif', mono: 'monospace', hand: 'cursive' };
  private destroyed = false;
  private ro?: ResizeObserver;
  sfx = new Sound();
  onAgentClick?: (id: string) => void;
  onShot?: (name: string) => void;

  static async create(el: HTMLElement): Promise<OfficeScene> {
    const s = new OfficeScene();
    await s.init(el);
    return s;
  }

  // ---------------------------------------------------------------- setup
  private txt(text: string, style: Record<string, unknown>, res = 2) {
    const t = new PIXI.Text({ text, style: { fontFamily: this.fonts.sans, ...style } as any });
    t.resolution = res;
    return t;
  }
  private tw<T extends object>(target: T, vars: gsap.TweenVars) {
    const done = vars.onComplete as (() => void) | undefined;
    const t: gsap.core.Tween = gsap.to(target, { ...vars, onComplete: () => { this.tweens.delete(t); done?.(); } });
    this.tweens.add(t);
    return t;
  }
  private wait(ms: number) { return new Promise<void>((r) => { const t = gsap.delayedCall(ms / 1000, () => { this.tweens.delete(t); if (!this.destroyed) r(); }); this.tweens.add(t); }); }
  private crops: { s: PIXI.Sprite; r: [number, number, number, number] }[] = [];
  private cropTex(x0: number, y0: number, x1: number, y1: number) {
    const k = this.bgTex.width / WW;
    return new PIXI.Texture({ source: this.bgTex.source, frame: new PIXI.Rectangle(x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k) });
  }
  private crop(x0: number, y0: number, x1: number, y1: number) {
    const s = new PIXI.Sprite(this.cropTex(x0, y0, x1, y1)); s.position.set(x0, y0); s.width = x1 - x0; s.height = y1 - y0;
    this.crops.push({ s, r: [x0, y0, x1, y1] });
    return s;
  }
  /** Swap in a sharper copy of the building (and everything cut from it) once it has loaded. */
  private upgradeBackground(tex: PIXI.Texture, bg: PIXI.Sprite) {
    if (this.destroyed) return;
    this.bgTex = tex;
    bg.texture = tex; bg.width = WW; bg.height = WH;
    for (const { s, r } of this.crops) { s.texture = this.cropTex(...r); s.width = r[2] - r[0]; s.height = r[3] - r[1]; }
  }
  private radial(size: number, stops: [number, string][]) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d')!, gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const [o, col] of stops) gr.addColorStop(o, col);
    g.fillStyle = gr; g.fillRect(0, 0, size, size); return PIXI.Texture.from(c);
  }

  private async init(el: HTMLElement) {
    this.el = el;
    this.fonts = { sans: css('--font-sans', 'Inter, sans-serif'), serif: css('--font-serif', 'Georgia, serif'), mono: css('--font-mono', 'monospace'), hand: css('--font-hand', 'cursive') };
    await document.fonts.ready;
    const small = Math.min(window.innerWidth, 1400) * (window.devicePixelRatio || 1) < 1500;
    await this.app.init({ resizeTo: el, background: 0xe9e2d3, antialias: true, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true });
    if (this.destroyed) return;
    this.app.canvas.style.display = 'block';
    el.appendChild(this.app.canvas);

    // First paint needs only the light building and each character's packed frames. The sharp building and
    // the walk sheets load afterwards, while the office is already on screen.
    const ids = [...SEATS, 'cfo'];
    const [bgTex, ...chars] = await Promise.all([PIXI.Assets.load('/scene/building-1920.webp'), ...ids.map(loadFrames)]);
    if (this.destroyed) return;
    this.bgTex = bgTex as PIXI.Texture;
    const byId = Object.fromEntries(ids.map((id, i) => [id, chars[i] as Frames]));

    const bg = new PIXI.Sprite(this.bgTex); bg.width = WW; bg.height = WH;
    this.lane.sortableChildren = true;
    this.world.addChild(bg, this.under, this.seats, this.occ, this.lane, this.fx);
    this.app.stage.addChild(this.world, this.hud);

    this.buildAmbient();
    this.buildScreen();
    this.buildBoard();

    // occluders cut straight from the art: things people stand behind
    for (let i = 0; i < DESK_EDGE.length; i++) {
      const [x0, x1] = DESK_EDGE[i];
      this.occ.addChild(this.crop(x0 - 2, DESK.top - 4, x1 + 2, DESK.bottom + 2));
      this.occ.addChild(this.crop(LAPTOP_X[i] - 40, 1302, LAPTOP_X[i] + 40, DESK.top));
    }
    this.occ.addChild(this.crop(CFO_DESK.x0 - 4, CFO_DESK.top - 4, CFO_DESK.x1 + 4, CFO_DESK.bottom + 2));
    this.occ.addChild(this.crop(2455, 710, 2585, CFO_DESK.top)); // his laptop
    this.occ.addChild(this.crop(TABLE.x0 - 4, TABLE.top - 4, TABLE.x1 + 4, TABLE.bottom + 2));
    this.occ.addChild(this.crop(RECEPTION.x0 - 4, RECEPTION.top - 36, RECEPTION.x1 + 4, RECEPTION.bottom + 12));
    this.occ.addChild(this.crop(COUNTER.x0 - 4, COUNTER.top - 40, COUNTER.x1 + 4, COUNTER.bottom + 10));
    this.occ.addChild(this.crop(COFFEE.x0 - 4, COFFEE.top - 4, COFFEE.x1 + 10, COFFEE.bottom + 10));

    // the lift car: back glass behind the rider, brass frame in front
    this.lift.back.rect(LIFT.x0, -410, LIFT.x1 - LIFT.x0, 410).fill({ color: 0xfff4d6, alpha: 0.22 }).rect(LIFT.x0, -410, LIFT.x1 - LIFT.x0, 18).fill({ color: 0xb08a3e, alpha: 0.95 });
    this.lift.front.rect(LIFT.x0, -410, LIFT.x1 - LIFT.x0, 410).stroke({ width: 10, color: 0xc9a45a, alpha: 0.95 }).rect(LIFT.x0, -14, LIFT.x1 - LIFT.x0, 14).fill({ color: 0x8c6a2c }).rect(LIFT.x0 + 14, -390, 16, 370).fill({ color: 0xffffff, alpha: 0.12 });
    this.lift.back.zIndex = 0; this.lift.front.zIndex = 99999;
    this.lane.addChild(this.lift.back, this.lift.front);

    // people
    SEATS.forEach((id, i) => {
      const a = new Actor(id, byId[id], WF, LAPTOP_X[i] + 4, SEAT_Y, SEATED);
      a.home = { x: DESK_X[i], laptop: LAPTOP_X[i] };
      a.mode = 'seat';
      a.last = 'at their desk';
      this.seats.addChild(a.root);
      this.actors.set(id, a);
      a.root.on('pointertap', () => this.onAgentClick?.(id));
      const glow = new PIXI.Sprite(this.radial(128, [[0, 'rgba(170,220,255,0.55)'], [1, 'rgba(170,220,255,0)']]));
      glow.anchor.set(0.5); glow.position.set(LAPTOP_X[i] + 4, DESK.top - 60); glow.scale.set(1.3, 1); glow.blendMode = 'add'; glow.alpha = 0;
      this.under.addChild(glow);
      this.laptopGlow.set(id, glow);
    });
    const cfo = new Actor('cfo', byId.cfo, CF, CFO_SPOT.x, CFO_SPOT.y, CFO_SCALE);
    cfo.mode = 'behind'; cfo.last = 'watching the vault';
    this.seats.addChild(cfo.root);
    this.actors.set('cfo', cfo);
    cfo.root.on('pointertap', () => this.onAgentClick?.('cfo'));

    this.layout();
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(el);

    this.app.ticker.add(() => this.tick());

    // Until its walk sheet arrives, an agent walks with its pose frames.
    for (const id of ids) {
      void Promise.all([loadCycle(`${id}-walk`, byId[id]), loadCycle(`${id}-carry`, byId[id])]).then(([walk, carry]) => {
        const a = this.actors.get(id);
        if (a && !this.destroyed) a.cycles = { walk, carry };
      });
    }
    if (!small) void PIXI.Assets.load('/scene/building.webp').then((t: PIXI.Texture) => this.upgradeBackground(t, bg)).catch(() => {});
  }

  private buildAmbient() {
    const warm = this.radial(256, [[0, 'rgba(255,214,140,0.55)'], [0.45, 'rgba(255,190,110,0.14)'], [1, 'rgba(255,190,110,0)']]);
    for (const x of LAMPS) {
      const s = new PIXI.Sprite(warm); s.anchor.set(0.5, 0.2); s.position.set(x, 1090); s.scale.set(1.5, 1.7); s.blendMode = 'add'; s.alpha = 0.55;
      this.under.addChild(s);
      this.tw(s, { alpha: 0.4 + Math.random() * 0.2, duration: 2 + Math.random() * 2, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    }
    // the tools shelves glow when a tool is bought
    this.shelfGlow = new PIXI.Graphics().roundRect(SHELVES.x0, SHELVES.y0, SHELVES.x1 - SHELVES.x0, SHELVES.y1 - SHELVES.y0, 20).fill({ color: 0x9ff0dc });
    this.shelfGlow.blendMode = 'add'; this.shelfGlow.alpha = 0; this.under.addChild(this.shelfGlow);
    // the rooftop sign breathes, and flares on revenue
    this.sign = new PIXI.Sprite(this.radial(256, [[0, 'rgba(255,225,150,0.6)'], [1, 'rgba(255,225,150,0)']]));
    this.sign.anchor.set(0.5); this.sign.position.set((SIGN.x0 + SIGN.x1) / 2, (SIGN.y0 + SIGN.y1) / 2); this.sign.scale.set(6, 1.7); this.sign.blendMode = 'add'; this.sign.alpha = 0.18;
    this.fx.addChild(this.sign);
    this.tw(this.sign, { alpha: 0.3, duration: 2.6, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    // the vault wheel is cut from the art so it can turn
    const r = 64, wheel = this.crop(VAULT.x - r, VAULT.y - r, VAULT.x + r, VAULT.y + r);
    wheel.anchor.set(0.5); wheel.position.set(VAULT.x, VAULT.y); wheel.width = wheel.height = r * 2;
    const mask = new PIXI.Graphics().circle(VAULT.x, VAULT.y, r - 2).fill(0xffffff);
    wheel.mask = mask; this.under.addChild(wheel, mask); this.vaultWheel = wheel;
    // dust in the sunbeams
    const dot = this.radial(32, [[0, 'rgba(255,240,210,1)'], [1, 'rgba(255,240,210,0)']]);
    for (let i = 0; i < 36; i++) {
      const s = new PIXI.Sprite(dot); s.anchor.set(0.5); s.blendMode = 'add';
      s.position.set(500 + Math.random() * 2600, 400 + Math.random() * 1600); s.scale.set(0.3 + Math.random() * 0.5); s.alpha = 0.1 + Math.random() * 0.25;
      this.under.addChild(s);
      this.tw(s, { x: `+=${60 + Math.random() * 120}`, y: `-=${40 + Math.random() * 90}`, alpha: 0, duration: 6 + Math.random() * 6, repeat: -1, delay: Math.random() * 6, ease: 'none' });
    }
  }

  private buildScreen() {
    const c = new PIXI.Container(); c.position.set(SCREEN.x0 + 26, SCREEN.y0 + 18);
    const title = this.txt('SYNCLY · AT WORK', { fontFamily: this.fonts.mono, fontSize: 19, fill: 0xe2ab45, letterSpacing: 3, fontWeight: '600' }, 3);
    const clock = this.txt('', { fontFamily: this.fonts.mono, fontSize: 19, fill: 0x9fb8ae }, 3); clock.anchor.set(1, 0); clock.x = SCREEN.x1 - SCREEN.x0 - 52;
    const rev = this.txt('—', { fontFamily: this.fonts.serif, fontSize: 64, fill: 0xf4ecda }, 3); rev.y = 30;
    const sub = this.txt('', { fontFamily: this.fonts.mono, fontSize: 18, fill: 0xc9d6cf }, 3); sub.y = 108;
    const tick = this.txt('waiting for the next job', { fontFamily: this.fonts.mono, fontSize: 17, fill: 0x9ff0dc }, 3); tick.y = 140;
    c.addChild(title, clock, rev, sub, tick);
    this.under.addChild(c);
    this.screen = { rev, sub, tick, clock, value: { rev: 0 } };
  }

  private buildBoard() {
    const c = new PIXI.Container(); c.position.set(WHITEBOARD.x0 + 34, WHITEBOARD.y0 + 22);
    const title = this.txt('', { fontFamily: this.fonts.hand, fontSize: 44, fill: 0x17473b, fontWeight: '700' }, 3);
    const body = this.txt('', { fontFamily: this.fonts.hand, fontSize: 34, fill: 0x243a8a, wordWrap: true, wordWrapWidth: WHITEBOARD.x1 - WHITEBOARD.x0 - 80, lineHeight: 36 }, 3); body.y = 56;
    const team = this.txt('', { fontFamily: this.fonts.hand, fontSize: 28, fill: 0xa13a2c }, 3); team.y = WHITEBOARD.y1 - WHITEBOARD.y0 - 64;
    c.addChild(title, body, team);
    this.under.addChild(c);
    this.board = { title, body, team, c };
    this.write(title, 'Next job goes here');
  }

  private write(t: PIXI.Text, s: string, dur = 0) {
    if (!dur) { t.text = s; return; }
    const o = { n: 0 };
    this.tw(o, { n: s.length, duration: dur, ease: 'none', onUpdate: () => { t.text = s.slice(0, Math.round(o.n)); } });
  }

  // ---------------------------------------------------------------- camera
  private layout() {
    if (this.destroyed || !this.app.renderer) return;
    this.app.resize();
  }
  private viewH(w: number) { return w * (this.app.screen.height / Math.max(1, this.app.screen.width)); }
  private applyCam() {
    const W = this.app.screen.width, H = this.app.screen.height;
    let { cx, cy, w } = this.cam;
    w = Math.min(w, WW, WH * (W / H));
    const h = this.viewH(w);
    cx = Math.max(w / 2, Math.min(WW - w / 2, cx)); cy = Math.max(h / 2, Math.min(WH - h / 2, cy));
    const k = W / w;
    const sx = this.shake ? (Math.random() - 0.5) * this.shake : 0, sy = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    this.world.scale.set(k);
    this.world.position.set(W / 2 - cx * k + sx, H / 2 - cy * k + sy);
  }
  private toScreen(p: P) { return { x: this.world.x + p.x * this.world.scale.x, y: this.world.y + p.y * this.world.scale.y }; }
  private go(shot: ShotName, dur = 1.25) {
    this.dir.current = shot; this.dir.follow = null;
    const s = SHOTS[shot];
    const tight = shot !== 'wide' && this.app.screen.width < 600 ? 0.78 : 1; // phones: closer shots so people read
    gsap.killTweensOf(this.cam);
    this.tw(this.cam, { cx: s.cx, cy: s.cy, w: s.w * tight, duration: dur, ease: 'power3.inOut' });
    this.onShot?.(shot);
  }
  /** Ask the director for a shot; it holds each shot long enough to read before cutting again. */
  private want(shot: ShotName, hold = 2500) {
    this.dir.lastEvent = performance.now();
    if (!this.dir.on) return;
    const now = performance.now();
    if (this.dir.follow) return; // following someone on a walk wins
    if (this.dir.current === shot) { this.dir.lockUntil = Math.max(this.dir.lockUntil, now + hold * 0.6); return; }
    if (now < this.dir.lockUntil) { this.dir.pending = [...this.dir.pending.filter((p) => p.shot !== shot), { shot, hold }].slice(-2); return; }
    this.go(shot);
    this.dir.lockUntil = now + hold;
  }
  private followActor(a: Actor | null) {
    if (!this.dir.on) return;
    this.dir.follow = a; this.dir.current = 'follow';
    if (a) { gsap.killTweensOf(this.cam); this.tw(this.cam, { w: 1650, duration: 1.1, ease: 'power2.inOut' }); this.onShot?.('follow'); }
  }
  /** While a job runs, its team keeps working between events: laptops lit, typing, until it's delivered. */
  setWorking(team: string[] | null) {
    clearInterval(this.workingTimer);
    this.workingTeam = team ?? [];
    if (!team?.length) { for (const b of this.bubbles.values()) b.until = Math.min(b.until, performance.now() + 1500); return; }
    const keep = () => { for (const r of team) { const a = this.actors.get(r); if (a && a.mode === 'seat') a.busyUntil = Math.max(a.busyUntil, performance.now() + 2600); } };
    keep();
    this.workingTimer = setInterval(keep, 2000);
  }
  private workingTimer: ReturnType<typeof setInterval> | undefined;
  private workingTeam: string[] = [];
  setDirector(on: boolean) {
    this.dir.on = on;
    this.dir.pending = [];
    this.dir.follow = null;
    this.go('wide', 1.1);
  }
  setSound(on: boolean) { this.sfx.setOn(on); if (on) this.sfx.chime(); }
  /** Debug: park the camera (director off). */
  peek(cx: number, cy: number, w: number) { this.dir.on = false; gsap.killTweensOf(this.cam); Object.assign(this.cam, { cx, cy, w }); this.applyCam(); this.app.render(); }
  showShot(shot: ShotName) { this.dir.follow = null; this.go(shot); this.dir.lockUntil = performance.now() + 5000; }

  // ---------------------------------------------------------------- per-frame
  private tick() {
    if (this.destroyed) return;
    const t = performance.now() / 1000;
    for (const a of this.actors.values()) a.update(t);
    for (const a of this.actors.values()) { a.root.zIndex = a.pos.y; }
    this.lift.back.y = this.lift.front.y = this.lift.y;
    // director: follow a walker, flush pending shots, drift back to the wide shot when quiet
    const now = performance.now();
    if (this.dir.on) {
      if (this.dir.follow) { this.cam.cx += (this.dir.follow.pos.x - this.cam.cx) * 0.06; this.cam.cy += (this.dir.follow.pos.y - 160 - this.cam.cy) * 0.06; }
      else if (now >= this.dir.lockUntil && this.dir.pending.length) { const p = this.dir.pending.shift()!; this.go(p.shot); this.dir.lockUntil = now + p.hold; }
      else if (this.dir.current !== 'wide' && !this.workingTeam.length && now - this.dir.lastEvent > 7000 && now >= this.dir.lockUntil) this.go('wide', 1.8);
    }
    if (this.shake > 0.3) this.shake *= 0.86; else this.shake = 0;
    this.applyCam();
    // laptop glow follows who is busy
    for (const [id, g] of this.laptopGlow) { const a = this.actors.get(id)!; const target = a.mode === 'seat' && a.busy ? 0.75 : 0; g.alpha += (target - g.alpha) * 0.08; }
    // screen-space bubbles track their speaker
    for (const [id, b] of this.bubbles) {
      const a = b.a, head = a.mode === 'seat' ? 236 : a.id === 'cfo' ? 340 : 330 * (a.scale / STAND);
      const p = this.toScreen({ x: a.pos.x, y: a.pos.y - head });
      const W = this.app.screen.width;
      b.c.position.set(Math.max(6, Math.min(W - b.c.width - 6, p.x - 26)), Math.max(6, p.y - b.c.height));
      const H = this.app.screen.height, inView = p.x > -20 && p.x < W + 20 && p.y > 0 && p.y < H + 40;
      b.c.visible = inView;
      if (now > b.until) { b.c.alpha -= 0.06; if (b.c.alpha <= 0) { this.hud.removeChild(b.c); b.c.destroy({ children: true }); this.bubbles.delete(id); } }
    }
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i], age = (now - f.t0) / 1000, p = this.toScreen(f.w);
      f.c.position.set(p.x, p.y - age * 38); f.c.alpha = Math.max(0, 1 - Math.max(0, age - 1.4) / 0.8);
      if (age > 2.3) { this.hud.removeChild(f.c); f.c.destroy({ children: true }); this.floats.splice(i, 1); }
    }
    // the wall clock on the books screen: Lagos time
    const lagos = new Date(Date.now() + (60 + new Date().getTimezoneOffset()) * 60000);
    const hhmm = `LAGOS ${String(lagos.getHours()).padStart(2, '0')}:${String(lagos.getMinutes()).padStart(2, '0')}`;
    if (this.screen.clock.text !== hhmm) this.screen.clock.text = hhmm;
  }

  // ---------------------------------------------------------------- effects
  private say(id: string, text: string, ms = 3600) {
    const a = this.actors.get(id); if (!a) return;
    const old = this.bubbles.get(id); if (old) { this.hud.removeChild(old.c); old.c.destroy({ children: true }); this.bubbles.delete(id); }
    // never more than three people talking at once: the oldest bubble makes way
    const small = this.app.screen.width < 600;
    while (this.bubbles.size >= (small ? 2 : 3)) { const [k, b] = this.bubbles.entries().next().value!; this.hud.removeChild(b.c); b.c.destroy({ children: true }); this.bubbles.delete(k); }
    const short = text.length > 64 ? text.slice(0, 62) + '…' : text;
    const c = new PIXI.Container();
    const who = this.txt(NAME[id] ?? id, { fontSize: small ? 9.5 : 11, fontWeight: '700', fill: COLOR[id] ?? 0x333333, letterSpacing: 0.5 }, window.devicePixelRatio || 2);
    const t = this.txt(small && short.length > 44 ? short.slice(0, 42) + '…' : short, { fontSize: small ? 10.5 : 13, fontWeight: '500', fill: 0x1b1a17, wordWrap: true, wordWrapWidth: small ? 150 : id === 'cfo' ? 250 : 200, lineHeight: small ? 13 : 17 }, window.devicePixelRatio || 2);
    const pad = small ? 6 : 9, w = Math.max(t.width, who.width) + pad * 2, h = t.height + who.height + pad * 2 + 2;
    const g = new PIXI.Graphics().roundRect(0, 0, w, h, 11).fill({ color: 0xffffff, alpha: 0.97 }).stroke({ width: 1, color: 0xe0d7c4 })
      .poly([18, h - 1, 32, h - 1, 16, h + 10]).fill({ color: 0xffffff, alpha: 0.97 });
    who.position.set(pad, pad - 1); t.position.set(pad, pad + who.height + 1);
    c.addChild(g, who, t);
    c.alpha = 0; c.scale.set(0.9);
    this.hud.addChild(c);
    this.tw(c, { alpha: 1, duration: 0.25 }); this.tw(c.scale, { x: 1, y: 1, duration: 0.35, ease: 'back.out(2)' });
    this.bubbles.set(id, { c, until: performance.now() + ms, a });
    a.last = text;
  }
  private float(w: P, text: string, color = 0x1b1a17, bg = 0xffffff) {
    const t = this.txt(text, { fontFamily: this.fonts.mono, fontSize: 13, fontWeight: '600', fill: color }, window.devicePixelRatio || 2);
    const c = new PIXI.Container();
    c.addChild(new PIXI.Graphics().roundRect(-t.width / 2 - 8, -12, t.width + 16, 24, 12).fill({ color: bg, alpha: 0.95 }), t);
    t.anchor.set(0.5); this.hud.addChild(c); this.floats.push({ c, w, t0: performance.now() });
  }
  private coin(from: P, to: P, opts: { delay?: number; arc?: number; dur?: number; gold?: boolean; onLand?: () => void } = {}) {
    const g = new PIXI.Container();
    g.addChild(new PIXI.Graphics().circle(0, 0, 22).fill(opts.gold ? 0xe8b43a : 0xf2cd63).stroke({ width: 5, color: 0x9c7a2b }).circle(0, 0, 11).stroke({ width: 3, color: 0xc49a3a }));
    g.position.set(from.x, from.y); g.visible = false; this.fx.addChild(g);
    const o = { q: 0 }, arc = opts.arc ?? 260;
    this.tw(o, {
      q: 1, duration: opts.dur ?? 1.05, delay: opts.delay ?? 0, ease: 'power1.inOut',
      onStart: () => { g.visible = true; },
      onUpdate: () => { g.position.set(from.x + (to.x - from.x) * o.q, from.y + (to.y - from.y) * o.q - Math.sin(o.q * Math.PI) * arc); g.scale.x = Math.cos(o.q * 18); },
      onComplete: () => { this.fx.removeChild(g); g.destroy({ children: true }); this.sfx.coin(); opts.onLand?.(); },
    });
  }
  private sparkle(x: number, y: number, color = 0xffe3a1, n = 10) {
    for (let i = 0; i < n; i++) {
      const s = new PIXI.Graphics().star(0, 0, 4, 14, 5).fill(color); s.position.set(x, y); s.blendMode = 'add'; this.fx.addChild(s);
      const an = Math.random() * Math.PI * 2, d = 60 + Math.random() * 110;
      this.tw(s, { x: x + Math.cos(an) * d, y: y + Math.sin(an) * d, alpha: 0, rotation: 2, duration: 0.7 + Math.random() * 0.4, ease: 'power2.out', onComplete: () => { this.fx.removeChild(s); s.destroy(); } });
    }
  }
  private envelope() {
    const e = new PIXI.Container();
    e.addChild(new PIXI.Graphics().roundRect(-40, -27, 80, 54, 5).fill(0xfbf6ea).stroke({ width: 3, color: 0xcbbd9c }).poly([-40, -27, 0, 6, 40, -27]).stroke({ width: 3, color: 0xcbbd9c }).circle(0, 6, 10).fill(0x8a8f96));
    this.fx.addChild(e); return e;
  }
  private seal(x: number, y: number, label: string) {
    const c = new PIXI.Container();
    c.addChild(new PIXI.Graphics().circle(0, 0, 44).fill(0x70747c).stroke({ width: 5, color: 0x4a4d53 }).circle(0, 0, 33).stroke({ width: 2.5, color: 0x9da1a8 }));
    const s = this.txt('SEALED', { fontSize: 14, fontWeight: '800', fill: 0xf2efe6 }, 3); s.anchor.set(0.5, 1); s.y = 3;
    const h = this.txt(label, { fontFamily: this.fonts.mono, fontSize: 11, fill: 0xdfe2e6 }, 3); h.anchor.set(0.5, 0); h.y = 4;
    c.addChild(s, h); c.position.set(x, y); c.scale.set(2.2); c.alpha = 0; this.fx.addChild(c);
    this.tw(c, { alpha: 1, duration: 0.12 }); this.tw(c.scale, { x: 1, y: 1, duration: 0.22, ease: 'power4.in' });
    return c;
  }

  // ---------------------------------------------------------------- movement
  private moveTo(a: Actor, x: number, y = a.pos.y, carry = false) {
    const d = Math.hypot(x - a.pos.x, y - a.pos.y);
    if (d < 2) return Promise.resolve();
    a.mode = carry ? 'carry' : 'walk';
    if (Math.abs(x - a.pos.x) > 2) a.facing = x > a.pos.x ? -1 : 1;
    const start = { ...a.pos }, base = a.walked;
    return new Promise<void>((res) => {
      this.tw(a.pos, { x, y, duration: d / SPEED, ease: 'none', onUpdate: () => { a.walked = base + Math.hypot(a.pos.x - start.x, a.pos.y - start.y); }, onComplete: () => { if (a.mode === 'walk') a.mode = 'stand'; res(); } });
    });
  }
  private toLane(a: Actor) { this.seats.removeChild(a.root); this.lane.addChild(a.root); }
  private toSeats(a: Actor) { this.lane.removeChild(a.root); this.seats.addChild(a.root); }
  private floorOf(y: number): Floor { return y < 1200 ? 'top' : y < 1780 ? 'mid' : 'ground'; }
  private async ride(a: Actor, to: Floor) {
    const from = this.floorOf(a.pos.y);
    if (a.mode === 'walk') a.mode = 'stand';
    // call the car
    this.lift.busy = this.lift.busy.then(async () => {
      if (Math.abs(this.lift.y - LANE[from]) > 2) await new Promise<void>((r) => this.tw(this.lift, { y: LANE[from], duration: Math.abs(this.lift.y - LANE[from]) / 900, ease: 'power2.inOut', onComplete: () => r() }));
      this.sfx.ding();
      const carrying = a.mode === 'carry';
      await this.moveTo(a, LIFT.x, LANE[from], carrying);
      a.mode = carrying ? 'carryStand' : 'stand'; a.facing = 1;
      await this.wait(250);
      await new Promise<void>((r) => this.tw(this.lift, { y: LANE[to], duration: Math.abs(LANE[to] - LANE[from]) / 820, ease: 'power2.inOut', onUpdate: () => { a.pos.y = this.lift.y; }, onComplete: () => r() }));
      this.sfx.ding();
      await this.wait(200);
      if (carrying) a.mode = 'carry';
    });
    await this.lift.busy;
  }
  private async leaveDesk(a: Actor, carry = false) {
    a.mode = 'behind'; a.scale = BEHIND; a.pos.y = DESK.back; a.hold = null;
    await this.wait(250);
    await this.moveTo(a, ROW_END, DESK.back, carry);
    this.toLane(a);
    const s = { k: BEHIND };
    this.tw(s, { k: STAND, duration: 0.3, onUpdate: () => { a.scale = s.k; } });
    await this.moveTo(a, ROW_END + 60, LANE.mid, carry);
  }
  private async returnToDesk(a: Actor) {
    if (!a.home) return;
    await this.moveTo(a, ROW_END + 60, LANE.mid);
    this.toSeats(a);
    const s = { k: STAND };
    this.tw(s, { k: BEHIND, duration: 0.3, onUpdate: () => { a.scale = s.k; } });
    await this.moveTo(a, ROW_END, DESK.back);
    await this.moveTo(a, a.home.laptop + 4, DESK.back);
    a.mode = 'seat'; a.scale = SEATED; a.pos.y = SEAT_Y; a.facing = 1;
  }

  // ---------------------------------------------------------------- choreography for each real event
  private async deliver(orderId?: string) {
    const m = this.actors.get('messenger'); if (!m || !m.home) return;
    m.then(async () => {
      this.say('messenger', 'On my way to the customer 📦', 3000);
      await this.wait(400);
      this.followActor(m);
      await this.leaveDesk(m, true);
      await this.moveTo(m, liftWait('messenger'), LANE.mid, true);
      await this.ride(m, 'ground');
      await this.moveTo(m, DOOR.cx + 40, LANE.ground, true);
      // out through the door
      const flash = new PIXI.Graphics().rect(DOOR.x0, DOOR.y0, DOOR.x1 - DOOR.x0, DOOR.y1 - DOOR.y0).fill({ color: 0xfff2cf }); flash.blendMode = 'add'; flash.alpha = 0; this.fx.addChild(flash);
      this.tw(flash, { alpha: 0.6, duration: 0.25, yoyo: true, repeat: 1, onComplete: () => { this.fx.removeChild(flash); flash.destroy(); } });
      await new Promise<void>((r) => this.tw(m.root, { alpha: 0, duration: 0.5, onComplete: () => r() }));
      this.float({ x: DOOR.cx, y: DOOR.y0 + 40 }, `delivered ${orderId ? orderId.slice(-6) : ''}`, 0x1f7a4a, 0xe3f2e8);
      this.followActor(null); this.dir.lockUntil = 0;
      await this.wait(2600);
      m.root.alpha = 1; m.facing = -1;
      await this.moveTo(m, liftWait('messenger'), LANE.ground);
      await this.ride(m, 'mid');
      await this.returnToDesk(m);
    });
  }

  private kickoff(e: OfficeEvent) {
    const d = e.data ?? {}, cfo = this.actors.get('cfo')!;
    const name = SERVICE[d.service] ?? d.service;
    const team: string[] = (d.team ?? []).filter((r: string) => this.actors.has(r));
    this.want('door', 1600);
    // a brief arrives through the front door, is logged at reception and rises to the CFO
    const env = this.envelope(); env.position.set(DOOR.cx, 1880); env.alpha = 0;
    const tl = gsap.timeline(); this.tweens.add(tl);
    tl.to(env, { alpha: 1, duration: 0.2 })
      .to(env, { x: 1220, y: 1760, duration: 0.8, ease: 'power2.out' })
      .to(env, { x: 2440, y: 740, duration: 1.2, ease: 'power2.inOut', onStart: () => this.want('cfo', 4200) }, '+=0.4')
      .add(() => {
        cfo.hold = CF.talk;
        this.say('cfo', `New job: ${name} · ${d.promo ? 'free first job' : `${Number(d.price).toFixed(2)} USDC, bond ${Number(d.bond).toFixed(2)}`}`, 3400);
      })
      .add(() => { cfo.hold = CF.stamp; }, '+=1.3')
      .add(() => {
        this.shake = 26; this.sfx.thud();
        const s = this.seal(2440, 730, (e.orderId ?? '').slice(-8));
        this.sparkle(2440, 730, 0xd6d9de, 12);
        this.wait(900).then(() => this.presentBrief(env, s, e, name, team));
      }, '+=0.35');
    for (const r of team) { const a = this.actors.get(r)!; a.busyUntil = performance.now() + 6000; }
  }

  /** The CFO walks the sealed brief over to the meeting-room whiteboard, presents it, and walks back. */
  private presentBrief(env: PIXI.Container, seal: PIXI.Container, e: OfficeEvent, name: string, team: string[]) {
    const cfo = this.actors.get('cfo')!, d = e.data ?? {};
    const carry = () => { const x = cfo.pos.x - 70 * cfo.facing, y = cfo.pos.y - 205; env.position.set(x, y); seal.position.set(x + 4, y - 4); };
    cfo.then(async () => {
      cfo.hold = null;
      this.followActor(cfo);
      this.app.ticker.add(carry);
      await this.moveTo(cfo, CFO_DESK.x0 - 70, CFO_SPOT.y); // out from behind his desk
      this.seats.removeChild(cfo.root); this.lane.addChild(cfo.root);
      await this.moveTo(cfo, CFO_DESK.x0 - 130, LANE.top);
      await this.moveTo(cfo, TABLE.x1 + 80, LANE.top);
      cfo.mode = 'stand'; cfo.facing = 1; cfo.hold = CF.talk;
      this.app.ticker.remove(carry);
      this.followActor(null); this.dir.lockUntil = 0; this.want('meeting', 4200);
      // pin it up and write the job on the board
      this.tw(env, { x: WHITEBOARD.x1 - 70, y: WHITEBOARD.y0 + 70, duration: 0.5, ease: 'power2.out' });
      this.tw(seal, { x: WHITEBOARD.x1 - 66, y: WHITEBOARD.y0 + 66, duration: 0.5, ease: 'power2.out' });
      this.board.title.text = ''; this.board.body.text = ''; this.board.team.text = '';
      this.write(this.board.title, `${name} · job #${(e.orderId ?? '').slice(-4)}`, 0.6);
      this.wait(600).then(() => this.write(this.board.body, String(d.brief ?? 'Brief sealed in the job file.').slice(0, 120), 1.4));
      this.wait(2000).then(() => this.write(this.board.team, `team: ${team.map((r) => NAME[r]).join(', ')}`, 0.9));
      this.say('cfo', `Team: ${team.map((r) => NAME[r]).slice(0, 4).join(', ')}${team.length > 4 ? ` +${team.length - 4}` : ''}. Let's go.`, 3000);
      await this.wait(3300);
      this.tw([env, seal], { alpha: 0, duration: 0.6, onComplete: () => { this.fx.removeChild(env, seal); env.destroy({ children: true }); seal.destroy({ children: true }); } });
      cfo.hold = null;
      await this.moveTo(cfo, CFO_DESK.x0 - 130, LANE.top);
      this.lane.removeChild(cfo.root); this.seats.addChild(cfo.root);
      await this.moveTo(cfo, CFO_DESK.x0 - 70, CFO_SPOT.y);
      await this.moveTo(cfo, CFO_SPOT.x, CFO_SPOT.y);
      cfo.mode = 'behind'; cfo.facing = 1;
    });
  }

  /** The Auditor takes checked work upstairs to the CFO for sign-off, then goes back to her desk. */
  private signOff(note: string) {
    const a = this.actors.get('auditor'), cfo = this.actors.get('cfo')!;
    if (!a || a.mode !== 'seat') return;
    a.mode = 'behind'; // claim her now so a second check does not queue a second trip
    a.then(async () => {
      this.say('auditor', 'Checked. Taking it to the CFO.', 2400);
      await this.wait(500);
      this.followActor(a);
      await this.leaveDesk(a);
      await this.moveTo(a, liftWait('auditor'), LANE.mid);
      await this.ride(a, 'top');
      await this.moveTo(a, CFO_DESK.x1 - 90, LANE.top);
      a.mode = 'stand'; a.facing = 1;
      await cfo.queue; // if the CFO is off presenting a brief, she waits at his desk until he is back
      this.followActor(null); this.dir.lockUntil = 0; this.want('cfo', 3000);
      this.say('auditor', note.length > 60 ? note.slice(0, 58) + '…' : note, 2800);
      await this.wait(900);
      cfo.hold = CF.thumbs; this.say('cfo', 'Signed off. Ship it.', 2200);
      await this.wait(2000);
      if (cfo.hold === CF.thumbs) cfo.hold = null;
      await this.moveTo(a, liftWait('auditor'), LANE.top);
      await this.ride(a, 'mid');
      await this.returnToDesk(a);
    });
  }

  // ---------------------------------------------------------------- public API: real events in
  /** Dim everyone not on this team (the job page's mini office). */
  focus(team: string[] | null) {
    for (const [id, a] of this.actors) a.root.alpha = !team || id === 'cfo' || id === 'messenger' || team.includes(id) ? 1 : 0.35;
  }

  setStats(s: Stats) {
    if (!this.screen) return;
    const v = this.screen.value;
    this.tw(v, { rev: s.jobs, duration: 1.2, ease: 'power2.out', onUpdate: () => { this.screen.rev.text = `${Math.round(v.rev)} jobs delivered`; } });
    this.screen.sub.text = `${s.calls} paid calls · ${s.settled} settled on Arc`;
  }

  handle(e: OfficeEvent) {
    if (this.destroyed || !this.actors.size) return;
    this.sfx.bump(e.type === 'order' ? 1 : 0.85);
    const d = e.data ?? {};
    const cfo = this.actors.get('cfo')!;
    const guest = SHARES[d.agent] && !this.actors.has(d.agent) ? d.agent : undefined;
    const seat = guest ? SHARES[guest] : d.agent;
    const tag = guest ? `${NAME[guest] ?? guest}: ` : '';
    if (e.type === 'step') {
      const a = this.actors.get(seat); if (!a) return;
      a.busyUntil = performance.now() + 7000;
      if (d.agent === 'auditor' && (d.step === 'check' || d.step === 'audit') && !/fail|missing|revise/i.test(String(d.note ?? ''))) { this.signOff(`${d.step} · ${d.note ?? 'pass'}`); return; }
      // on a live job the newest step stays up until the next one (a long step doesn't look idle); the last one fades
      const live = this.workingTeam.length > 0;
      if (live) for (const [k, b] of this.bubbles) if (k !== seat) b.until = Math.min(b.until, performance.now() + 1200);
      if (a.mode === 'seat' || a.id === 'cfo') this.say(seat, `${tag}${d.step}${d.note ? ` · ${d.note}` : ''}`, live ? 45000 : 3600);
      else a.last = `${tag}${d.step}${d.note ? ` · ${d.note}` : ''}`;
      this.want('work', 2600);
    } else if (e.type === 'purchase') {
      const a = this.actors.get(seat); if (!a) return;
      a.busyUntil = performance.now() + 7000;
      const from = a.home ? { x: a.home.laptop, y: DESK.top - 70 } : { x: a.pos.x, y: a.pos.y - 200 };
      const to = { x: 2320 + (Math.random() - 0.5) * 300, y: COUNTER.top - 30 };
      this.coin(from, to, { arc: 200 + Math.random() * 120, onLand: () => {
        this.shelfGlow.alpha = 0.22; this.tw(this.shelfGlow, { alpha: 0, duration: 0.9 });
        this.sparkle(to.x, to.y, 0x9ff0dc, 6);
        this.float({ x: to.x, y: to.y - 60 }, `paid ${String(d.vendor ?? '').split(' ')[0]}`);
      } });
      this.screen.tick.text = `${NAME[d.agent] ?? d.agent} → ${d.vendor}`;
      this.want('work', 2000);
    } else if (e.type === 'order') {
      const team: string[] = (d.team ?? []).filter((r: string) => this.actors.has(r));
      if (d.status === 'queued') this.kickoff(e);
      else if (d.status === 'delivered') {
        this.want('work', 2200);
        this.sfx.chime();
        for (const r of team) {
          const a = this.actors.get(r)!;
          if (a.mode !== 'seat') continue;
          a.mode = 'behind'; a.scale = BEHIND; a.pos.y = DESK.back; a.hold = WF.cheer;
          this.wait(2400).then(() => { if (a.hold === WF.cheer) { a.hold = null; a.mode = 'seat'; a.scale = SEATED; a.pos.y = SEAT_Y; } });
        }
        this.say(team.includes('auditor') ? 'auditor' : 'cfo', 'Checked and delivered. Over to the customer.', 3000);
        this.wait(1800).then(() => this.deliver(e.orderId));
      } else if (d.status === 'accepted') {
        cfo.hold = CF.thumbs; this.wait(2600).then(() => { if (cfo.hold === CF.thumbs) cfo.hold = null; });
        if (!d.promo) {
          this.want('wide', 3800);
          for (let i = 0; i < 6; i++) this.coin({ x: DOOR.cx, y: 1850 }, { x: VAULT.x, y: VAULT.y }, { delay: i * 0.12, arc: 520, dur: 1.5, onLand: i === 5 ? () => {
            this.tw(this.vaultWheel, { rotation: `+=${Math.PI * 1.5}`, duration: 1.4, ease: 'power3.out' });
            this.sfx.cash();
            this.sparkle(VAULT.x, VAULT.y, 0xffd76a, 16);
            this.float({ x: VAULT.x, y: VAULT.y - 120 }, `+${Number(d.price).toFixed(2)} USDC revenue`, 0x1f7a4a, 0xe3f2e8);
            this.sign.alpha = 0.9; this.tw(this.sign, { alpha: 0.2, duration: 1.8 });
          } : undefined });
          this.say('cfo', d.by === 'auto' ? `Auto-accepted after 48 h: +${Number(d.price).toFixed(2)} revenue` : `Accepted: +${Number(d.price).toFixed(2)} USDC revenue`, 3600);
        } else {
          this.want('cfo', 2600);
          this.say('cfo', 'Free job accepted. A happy first customer.', 3200);
        }
      } else if (d.status === 'rejected' || d.status === 'failed') {
        cfo.hold = CF.stern; this.wait(3000).then(() => { if (cfo.hold === CF.stern) cfo.hold = null; });
        this.want('wide', 3800);
        this.sfx.sad();
        for (const r of team) {
          const a = this.actors.get(r)!;
          if (a.mode !== 'seat') continue;
          a.mode = 'behind'; a.scale = BEHIND; a.pos.y = DESK.back; a.hold = WF.sad;
          this.wait(3200).then(() => { if (a.hold === WF.sad) { a.hold = null; a.mode = 'seat'; a.scale = SEATED; a.pos.y = SEAT_Y; } });
        }
        if (d.refund) {
          this.tw(this.vaultWheel, { rotation: `-=${Math.PI}`, duration: 1.2, ease: 'power3.out' });
          for (let i = 0; i < 4; i++) this.coin({ x: VAULT.x, y: VAULT.y }, { x: DOOR.cx, y: 1850 }, { delay: i * 0.12, arc: 380, dur: 1.4 });
          for (let i = 0; i < 3; i++) this.coin({ x: VAULT.x, y: VAULT.y }, { x: DOOR.cx, y: 1850 }, { delay: 0.6 + i * 0.12, arc: 440, dur: 1.4, gold: true, onLand: i === 2 ? () => this.float({ x: DOOR.cx + 120, y: 1760 }, `refund ${Number(d.refund.priceUsd).toFixed(2)} + bond ${Number(d.refund.bondUsd).toFixed(2)}`, 0xb3412f, 0xfbe8e3) : undefined });
          this.say('cfo', `${d.status === 'failed' ? 'We missed it' : 'Rejected'}: refund + ${Number(d.refund.bondUsd).toFixed(2)} bond paid.`, 3800);
        } else this.say('cfo', d.status === 'failed' ? "We couldn't deliver this one." : 'Rejected. We learn from it.', 3200);
      } else if (d.status === 'revision') {
        cfo.hold = CF.talk; this.wait(1800).then(() => { if (cfo.hold === CF.talk) cfo.hold = null; });
        this.want('cfo', 2400);
        this.say('cfo', 'Revision requested. Back to work.', 2600);
        for (const r of team) this.actors.get(r)!.busyUntil = performance.now() + 6000;
      }
    }
  }

  destroy() {
    this.destroyed = true;
    clearInterval(this.workingTimer);
    this.ro?.disconnect();
    this.sfx.destroy();
    for (const t of this.tweens) t.kill();
    this.tweens.clear();
    gsap.killTweensOf(this.cam);
    try { this.app.destroy(true, { children: true }); } catch { /* not initialised yet */ }
  }
}
