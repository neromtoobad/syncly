import { useEffect, useState } from 'react';
import type React from 'react';

export const NGN_PER_USD = 1392; // ≈ the live naira checkout price per USDC (Bachs rate + 3.5%), Oct 2026; shown as an approximation only

export const usd = (x: number, d = 2) => `${x.toFixed(d)}`;
export const ngn = (x: number) => `≈ ₦${Math.round(x * NGN_PER_USD).toLocaleString('en-NG')}`;

export const ROLE_NAME: Record<string, string> = {
  cfo: "The CFO", scout: "Scout", researcher: "Researcher", writer: "Writer", illustrator: "Designer",
  verifier: "Verifier", mailer: "Mailer", reader: "Reader", analyst: "Analyst", messenger: "Messenger", auditor: "Auditor",
  producer: "Producer", bookkeeper: "Bookkeeper", linguist: "Linguist", investigator: "Investigator",
};

/** Who each character is. t = the soft tint behind them, c = their signature colour (taken from their outfit). */
export const ROLES: Record<string, { title: string; blurb: string; c: string; t: string }> = {
  cfo: { title: "Chief Financial Officer", blurb: "Prices every job, sizes the bond, and runs the vault. He never grades his own team’s work: you do.", c: "#17473b", t: "#e1ece5" },
  scout: { title: "Finds things", blurb: "Searches the web and Google Maps for exactly what the brief asks for.", c: "#d9a21b", t: "#fbefcc" },
  researcher: { title: "Plans the work", blurb: "Turns your brief into a search plan, then drafts the answer with citations.", c: "#7a2335", t: "#f4e2e5" },
  writer: { title: "Writes it up", blurb: "Plain-English briefs and a personal first line for every lead.", c: "#e1705c", t: "#fce6df" },
  illustrator: { title: "Makes the images", blurb: "On-brand images for content packs and social posts.", c: "#8f79c9", t: "#eee8f8" },
  mailer: { title: "Sends the outreach", blurb: "Sends and tracks outreach on your behalf.", c: "#ec7418", t: "#fde9d6" },
  reader: { title: "Reads the sources", blurb: "Opens websites and PDFs and pulls out what matters.", c: "#556b2f", t: "#e9eedb" },
  analyst: { title: "Crunches the numbers", blurb: "Counts, ratings, patterns: the summary on top of every list.", c: "#2848b8", t: "#e2e7f8" },
  messenger: { title: "Delivers the work", blurb: "Packages files and gets them to you.", c: "#cf2a2a", t: "#fbe2df" },
  auditor: { title: "Quality control", blurb: "Checks the work on a different AI model before you ever see it.", c: "#5a2d5f", t: "#eee3ef" },
  producer: { title: "Makes the videos", blurb: "Motion ads with their own soundtrack, and the video in every ad launch.", c: "#c2187a", t: "#fbe0ee" },
  investigator: { title: "Checks everything", blurb: "Live-checks every email, phone number and seller, and asks the AI assistants what they say about you.", c: "#8a6232", t: "#f4eadb" },
  // retired on 2026-10-01 (the Investigator took over); kept so old jobs still show his face
  verifier: { title: "Checked contacts (retired)", blurb: "Live-checked emails and phone numbers; the Investigator does this now.", c: "#5f97d1", t: "#e2edf9" },
};
export const HAS_ART = new Set(Object.keys(ROLES));
export const tint = (role: string) => ({ ["--t" as any]: ROLES[role]?.t, ["--c" as any]: ROLES[role]?.c }) as React.CSSProperties;

/** Worker frames: 0 idle, 1-2 walk, 3 typing, 4 cheer, 5 sad, 6 box, 7 coin. CFO: 3 talk, 4 stamp, 5 stern, 6 thumbs, 7 deny. */
export function Sprite({ role, frame = 0, className = "", style }: { role: string; frame?: number; className?: string; style?: React.CSSProperties }) {
  if (!HAS_ART.has(role)) return null;
  return <img className={`sprite ${className}`} src={`/sprites/${role}/${role}-${frame}.png`} alt={ROLE_NAME[role] ?? role} style={style} draggable={false} />;
}

export function Avatar({ role, lg, xl }: { role: string; lg?: boolean; xl?: boolean }) {
  const img = HAS_ART.has(role) ? `url(/sprites/${role}/${role}-0.png)` : undefined;
  return <span className={`avatar${lg ? " lg" : ""}${xl ? " xl" : ""}`} style={{ backgroundImage: img, ...tint(role) }} title={ROLE_NAME[role] ?? role}>{!img && <i className="initial">{(ROLE_NAME[role] ?? role).replace(/^The /, "").slice(0, 1)}</i>}</span>;
}

export function Check({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/** Soft backdrop per department, for service cards. */
export const DEPT_TINT: Record<string, string> = { "Marketing": "#eee8f8", "Sales & Research": "#fbefcc", "Buying": "#e2edf9", "Research": "#f4e2e5", "Sales & Growth": "#fbefcc", "Growth Studio": "#eee8f8", "Buying & Suppliers": "#e2edf9", "Content & Creative": "#eee8f8", "Web & Tech": "#e2edf9", "Finance & Ops": "#e1ece5" };

export function Seal({ size = 32 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <defs><radialGradient id="lead" cx="40%" cy="35%"><stop offset="0" stopColor="#a4a9b0" /><stop offset="1" stopColor="#5d626a" /></radialGradient></defs>
      <circle cx="32" cy="32" r="30" fill="url(#lead)" stroke="#43474e" strokeWidth="2" />
      <circle cx="32" cy="32" r="23" fill="none" stroke="#d6dae0" strokeOpacity=".6" strokeWidth="1.5" strokeDasharray="2 3" />
      <text x="32" y="41.5" textAnchor="middle" fontFamily="Cinzel, serif" fontWeight="700" fontSize="27" fill="#f4f1ea">S</text>
    </svg>
  );
}

/** The owner's key for the private books, kept on this device only. With it, the API also returns costs. */
export const OWNER_KEY = 'syncly:owner';
const ownerHeader = (): Record<string, string> => { try { const k = localStorage.getItem(OWNER_KEY); return k ? { 'x-owner-key': k } : {}; } catch { return {}; } };

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...ownerHeader(), ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as T;
}

export function useApi<T>(path: string, refreshMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => api<T>(path).then((d) => live && setData(d)).catch((e) => live && setError(e.message));
    load();
    const t = refreshMs ? setInterval(load, refreshMs) : undefined;
    return () => { live = false; if (t) clearInterval(t); };
  }, [path, refreshMs]);
  return { data, error, setData };
}

/** A localStorage-backed string that is safe to render on the server (loads after mount). */
export function useStored(key: string, initial = "") {
  const [v, setV] = useState(initial);
  useEffect(() => { try { const x = localStorage.getItem(key); if (x != null) setV(x); } catch {} }, [key]);
  return [v, setV] as const;
}

export const timeAgo = (iso: string) => {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
};

export type Service = {
  id: string; name: string; dept: string; live: boolean; priceUsd: number; listedCostUsd?: number; etaMin: number;
  tagline: string; youGet: string[]; team: string[]; example: string;
};
export type Quote = { priceUsd: number; promo: boolean; bondUsd: number; bondBps: number; estCostUsd?: number; pAccept: number; expectedProfitUsd?: number; decision: 'quote' | 'decline'; deliverHours: number; reasons: string[] };
export type Receipt = { at: string; agent: string; vendor: string; usd?: number; transaction: string; reason: string; dry: boolean; settledTx?: string };
export type Step = { at: string; agent: string; step: string; note: string };
export type Run = { id: string; status: string; steps: Step[]; receipt: Receipt[]; deliverable: string; files: string[]; qa?: { verdict: string; notes: string; model: string }; spentUsd?: number; error?: string };
export type Order = {
  id: string; service: string; brief: string; email: string; createdAt: string; quote: Quote; status: string;
  payment?: { mode: string; at: string; tx?: string }; runs: Run[]; revisionNote?: string; deliveredAt?: string;
  decision?: { kind: string; at: string; by: string; note?: string }; refund?: { priceUsd: number; bondUsd: number; tx?: string }; demo: boolean;
  live: { jobId: string; steps: Step[]; receipt: Receipt[] } | null;
  escrow?: Escrow;
  details?: Record<string, unknown> & { name?: string };
  naira?: { ngn: number; rate: number; status: string; paidAt?: string; fundTx?: string; refund?: { ngn: number; status: string; bondNgn?: number } };
};
/** A paid job's escrow on Arc. `spec` is the exact text whose keccak256 is sealed on-chain as specHash. */
export type Escrow = {
  id: `0x${string}`; customer: `0x${string}`; spec: string; specHash: string; state: string; fundBy: string; deliverBy: string; acceptBy?: string;
  openTx: string; fundTx?: string; submitTx?: string; deliverableHash?: string; closeTx?: string;
};
export type AgentStats = { jobs: number; steps: number; calls: number; usd: number; vendors: string[]; last?: { at: string; step: string; orderId: string } };
export type BooksSummary = {
  mode: "demo" | "live"; asOf: string;
  counters: { orders: number; quotes: number; customers: number; delivered: number; accepted: number; rejected: number; acceptanceRate: number | null; freeJobs: number; toolCalls: number };
  pnl: { revenue: number; tools: number; experts: number; guarantee: number; grossMargin: number; byVendor: Record<string, number>; bondsPaid: number; refunds: number };
};
export const SERVICE_NAME: Record<string, string> = {
  "research-brief": "Market Research", "find-customers": "Find Customers", "money-report": "Money Report", "flyers": "Flyers & Price Lists", "local-business-finder": "Local Business Finder", "lead-list": "Lead List",
  "content-pack": "Social Media Posts", website: "Business Website", "motion-ad": "Promo Video", "video-ad": "Video Ad",
  "best-price": "Best Price Finder", "ai-answer-audit": "AI Answer Audit", "vendor-check": "Check Before You Pay",
  "ad-launch": "Ad Campaign", "product-photos": "Product Photos", "get-found": "Market & Google Report", "buy-smart": "Best Price & Seller Check",
};
