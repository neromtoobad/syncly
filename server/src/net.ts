// Fetching URLs that came from customers, their websites or sellers. They must never reach our own server, the
// Railway private network or cloud metadata, so every hop (redirects included) is resolved and checked against
// private address ranges before it's requested, and bodies are read with a size cap and a timeout.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** True for addresses on the public internet; false for loopback, private, link-local, CGNAT and the like. */
export function isPublicIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)));
  }
  if (v === 6) {
    const s = ip.toLowerCase().replace(/^\[|\]$/g, '');
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicIp(mapped[1]);
    if (s.startsWith('::ffff:') || s === '::' || s === '::1') return false;
    return !/^(f[cd]|fe[89ab]|ff|64:ff9b|2001:db8|0{0,4}:)/.test(s);
  }
  return false;
}

const seen = new Map<string, { ok: boolean; at: number }>();
/** Whether a URL is http(s) and every address its host resolves to is public. */
export async function publicUrl(u: string): Promise<boolean> {
  let url: URL;
  try { url = new URL(u); } catch { return false; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || /\.(local|internal|localhost)$/.test(host)) return false;
  if (isIP(host)) return isPublicIp(host);
  const hit = seen.get(host);
  if (hit && Date.now() - hit.at < 60_000) return hit.ok;
  const ok = await lookup(host, { all: true, verbatim: true }).then((a) => a.length > 0 && a.every((x) => isPublicIp(x.address))).catch(() => false);
  seen.set(host, { ok, at: Date.now() });
  return ok;
}

/** GET a public URL: redirects followed by hand (each hop checked), a timeout, and a byte cap while reading. */
export async function fetchPublic(u: string, opts: { maxBytes: number; timeoutMs?: number; hops?: number }): Promise<Response & { buf: Buffer }> {
  let url = u;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 30_000);
  for (let hop = 0; hop <= (opts.hops ?? 5); hop++) {
    if (!(await publicUrl(url))) throw new Error('that address is not a public web address');
    const res = await fetch(url, { redirect: 'manual', signal });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = new URL(res.headers.get('location')!, url).href; continue; }
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > opts.maxBytes) throw new Error(`file too large (${(len / 1e6).toFixed(1)} MB)`);
    const chunks: Buffer[] = [];
    let n = 0;
    if (res.body) for await (const c of res.body as any as AsyncIterable<Uint8Array>) {
      n += c.length;
      if (n > opts.maxBytes) throw new Error(`file too large (over ${(opts.maxBytes / 1e6).toFixed(0)} MB)`);
      chunks.push(Buffer.from(c));
    }
    return Object.assign(res, { buf: Buffer.concat(chunks) });
  }
  throw new Error('too many redirects');
}
