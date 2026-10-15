// Buy Smart: the cheapest trustworthy offer for each thing a business needs to buy, delivered, and a
// RED / AMBER / GREEN check on the sellers that matter before any money moves. Researcher parses the order
// and the sellers the owner is already talking to (order-form values are exact and override the parse) →
// the Best Price core: Scout searches Google Shopping, the local marketplaces, imports and the open web;
// Researcher sorts real offers from noise; Analyst prices them delivered in the owner's currency; Reader
// re-opens the top pages; Auditor (other model family) vets the picks → Investigator decides which sellers
// to check, by rules in code: every seller the owner listed (up to 3), plus the best pick for an item when
// it comes from a classified ad, an Instagram/WhatsApp seller or a shop we don't know (big retailers and
// marketplace stores are skipped, with the reason); at most 3 checks, planned inside the job's budget →
// the Check Before You Pay core runs on each, one after another: Investigator (phone fraud signals, domain
// age, business status, and sanctions only when $500+ is at stake and no red flag already says "don't pay
// upfront"), Scout (scam-report searches, Places), Analyst (Instagram), Reader; the verdict comes from
// fixed rules; Writer explains it, Auditor checks the wording → one report, offers.csv and the raw signals
// → QA: both cores' own checks, then code checks every amount in the report traces to an offer we found
// (or, for the sellers, to the owner's message or a cited signal) and every verdict is the rules' verdict.
import { Job } from '../job.ts';
import { MODELS } from '../config.ts';
import { HOSTS, llm, parseJson } from '../tools.ts';
import { AISA } from '../sellers.ts';
import { MAIL_BUDGET_USD, MAIL_HOST } from '../mail.ts';
import type { BusinessDetails } from '../details.ts';
import * as BP from './best-price.ts';
import * as VC from './vendor-check.ts';
import { scenarioOf } from './vendor-check.fixtures.ts';
import * as F from './buy-smart.fixtures.ts';

type SellerIn = {
  text?: string | null; name?: string | null; entity?: string | null; location?: string | null; address?: string | null; phone?: string | null;
  website?: string | null; instagram?: string | null; tiktok?: string | null; email?: string | null; bankAccountName?: string | null;
  quoted?: { amount?: number; currency?: string } | null; claimedYears?: number | null; detailsChanged?: boolean | null;
};
type Spec = BP.Spec & { sellers?: SellerIn[]; wantsSanctions?: boolean };
type Seller = {
  name: string; text: string; listed: boolean; why: string; src?: SellerIn; parsed: VC.Parsed; v: VC.Payee;
  items: number[]; // items it is the best pick for
  theirs: BP.Offer[]; // offers of its that we found (a seller the owner listed)
  stake?: number; stakeWhy: string;
  skip?: string; tag?: string; // why it is not checked (long, and short for the table)
  noSanctions?: string; plannedUsd?: number;
  check?: VC.Check; failed?: string;
};

const MAX_LISTED = 3, MAX_CHECKS = 3;
const SELLER_RULES = 'We always check the sellers you listed (up to 3), and the best pick for an item when it comes from a classified ad, an Instagram or WhatsApp seller, or a shop we don\'t know. Big retailers and marketplace stores are not checked when you pay through their own checkout or on delivery. At most 3 checks per order. Sanctions screening runs only when $500 or more would go to one seller and the other checks have not already put them at high risk.';

const PARSE = (() => {
  const end = '"marketplaces": [3-5 domains of the biggest online shops in that country]}';
  const sellers = '"sellers": [every seller the owner is already talking to or considering, in the order given (an empty list if none): {"text": the exact words of the request that describe this seller, copied verbatim, "name": business or person name as written, or null, "entity": "company"|"person", "location": area and city or null, "address": street, plaza or market address or null, "phone": exactly as written or null, "website": as written or null, "instagram": handle or null, "tiktok": handle or null, "email": or null, "bankAccountName": the account name they gave for payment, or null, "quoted": {"amount": number, "currency": ISO code} the total this seller quoted, or null, "claimedYears": years in business the seller claims, only if stated, else null, "detailsChanged": true only if the request says this seller changed or sent new bank details}], "wantsSanctions": true only if the owner asks for a sanctions or AML check';
  const p = BP.SHOP_PARSE.includes(end) ? BP.SHOP_PARSE.replace(end, `${end.slice(0, -1)}, ${sellers}}`) : `${BP.SHOP_PARSE} Also include ${sellers}.`;
  return `${p} When the request has a "To buy" list, give one item per line of it, in the same order. Copy seller identifiers exactly; never invent one.`;
})();

const flat = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const digits = (s: string) => s.replace(/\D/g, '');
const GENERIC = new Set(['ltd', 'limited', 'nig', 'nigeria', 'ng', 'enterprise', 'enterprises', 'ventures', 'global', 'services', 'store', 'stores', 'shop', 'official', 'company', 'co', 'the', 'and', 'appliances', 'appliance', 'equipment', 'electronics', 'kitchen', 'home', 'gadgets', 'phones', 'lagos', 'abuja']);
const UNIT = /^(l|lt|ltr|litres?|liters?|kg|kva|w|watts?|v|volts?|inch(es)?|"|cm|mm|g|ml|gb|tb|hp|ah|mah)\b/i;

/** "2 chest freezers", "Chest freezer x2", "3 pcs fryer": the quantity a form line states, if any. */
function qtyOf(line: string): number | undefined {
  const lead = line.match(/^\s*(\d{1,3})\s*(?:x|×|pcs?\.?|pieces?|units?|nos?\.?)?\s+(\S.*)$/i);
  if (lead && !UNIT.test(lead[2])) return Number(lead[1]);
  const tail = line.match(/(?:x|×)\s*(\d{1,3})\s*$/i) ?? line.match(/\b(\d{1,3})\s*(?:pcs|pieces|units)\b/i);
  return tail ? Number(tail[1]) : undefined;
}
const stripQty = (line: string) => line.replace(/^\s*\d{1,3}\s*(?:x|×|pcs?\.?|pieces?|units?|nos?\.?)?\s+(?=\S)/i, (m) => (UNIT.test(line.slice(m.length)) ? m : '')).replace(/\s*(?:x|×)\s*\d{1,3}\s*$/i, '').trim();

/** A classified ad names its seller at the end of the title ("…, Femi Catering Equipment") or in the snippet. */
const adSeller = (o: BP.Offer) => o.store ?? o.title.match(/,\s*([^,|]{3,60}?)\s*$/)?.[1]?.trim() ?? o.snippet.match(/\b(?:call|seller:?|sold by)\s+([A-Z][\w&' -]{2,40})/)?.[1]?.trim();
const adPlace = (o: BP.Offer) => o.title.match(/\bin ([A-Z][\w ]{2,30}?) - /)?.[1];

/** What to check on delivery, before paying, by the kind of thing it is. Code, so it's the same advice every time. */
export function inspectList(name: string, condition: string): string[] {
  const n = name.toLowerCase(), used = condition !== 'new';
  const out: string[] = [];
  if (/phone|iphone|samsung|tecno|infinix|itel|pixel|ipad|tablet|laptop|macbook|notebook|computer|console|playstation|xbox|watch|airpod|earbud|camera/.test(n)) out.push(
    'Switch it on in front of the seller; check the screen, buttons, speakers, cameras and charging port all work',
    'The serial or IMEI number on the device (Settings → About, or dial *#06#) matches the box and the receipt',
    'Signed out of the previous owner\'s iCloud or Google account, and not locked to a network',
    ...(used ? ['Battery health (iPhone: Settings → Battery) and that it holds a charge', 'No swollen battery, bent frame or replaced screen (check the edges and the True Tone/display settings)'] : ['Factory seal intact on a "new" box; the charger and cable are original']));
  else if (/fridge|freezer|deep ?freez|air ?con|\bac\b|generator|gen\b|inverter|solar|battery|fryer|oven|cooker|blender|washing|microwave|fan|tv|television|stabili[sz]er|pump|machine/.test(n)) out.push(
    /fridge|freez/.test(n) ? 'Plug it in on the spot and let it run until it starts cooling (give it 20 to 30 minutes)' : /generator|gen\b/.test(n) ? 'Start it on the spot and let it run steady with something plugged in' : /inverter|solar|battery/.test(n) ? 'Connect it and check it powers a load; for batteries, check the charge level and the date code' : 'Plug it in and run it on the spot, through a full cycle if it has one',
    'Model number and capacity (litres, kVA, watts) on the rating plate match what you paid for',
    'No dents, rust, cracks or oil and gas smell; doors and seals close properly',
    'Warranty card stamped and dated, with the seller\'s name on the receipt',
    ...(used ? ['Ask how old it is and why it\'s being sold; look for signs of repair (new screws, re-welded pipes)'] : []));
  else if (/cement|rod|iron|block|tile|paint|roof|sheet|pipe|wire|cable|plank|wood|sand|granite|marble|pop\b/.test(n)) out.push(
    'Count the quantity before it\'s off-loaded and again after',
    'Grade, size and gauge on the bags, bundles or labels match the order (e.g. 12 mm rods, 42.5R cement)',
    'Nothing wet, rusted, cracked or broken; bags sealed and full weight',
    'Same batch or shade for tiles and paint, so they match');
  else if (/shoe|bag|dress|shirt|cloth|fabric|ankara|wig|hair|perfume|cream|watch|jewel|gold/.test(n)) out.push(
    'Size, colour and material match the pictures; check stitching, zips and clasps',
    'For hair, perfume and creams: seals unbroken and the batch and expiry dates printed',
    'Branded goods: compare the logo, tags and packaging with the brand\'s own website; fakes are common');
  out.push(...(out.length ? [] : ['It matches the listing: model, size, colour and quantity', 'Nothing broken, missing or damaged in transit']),
    'A receipt or invoice with the seller\'s name, the item and the amount',
    'Pay into an account in the business\'s name, never a different person\'s "for delivery"');
  return out;
}

export const buySmart = {
  id: 'buy-smart',
  name: 'Buy Smart',
  priceUsd: 2,
  // Typical tools: ~$0.10 for the prices, ~$0.07 per seller found online, ~$0.13 per listed seller with a
  // phone (+$0.30 with an Instagram handle), +$0.36 for a sanctions screen. The plan keeps the worst case
  // (3 Instagram sellers, all at $500+) inside this cap by dropping screens before whole checks.
  policy: { budgetUsd: 2.0 + MAIL_BUDGET_USD, allowHosts: [HOSTS.blockrun, HOSTS.orthogonal, HOSTS.apex, HOSTS.exa, AISA, ...(MAIL_HOST ? [MAIL_HOST] : [])] },

  async run(brief: string, opts: { orderId?: string; details?: BusinessDetails } = {}): Promise<Job> {
    const job = new Job(this.id, brief, this.policy, opts.orderId);
    try {
      // 1. What to buy, where it goes, the budget, and the sellers already in the conversation
      job.log('researcher', 'parse', 'items, quantity, condition, delivery, budget, and the sellers you are talking to');
      const raw = parseJson<Spec>(
        await llm(job, 'researcher', [
          { role: 'system', content: PARSE },
          { role: 'user', content: brief },
        ], 'parse the order and the sellers', { model: MODELS.fast, maxTokens: 1200, json: true, dry: () => F.parse(brief) }),
        { ...BP.EMPTY_SPEC, sellers: [] },
      );
      if ((!raw.gl || (raw.gl === 'us' && !raw.country)) && /lagos|abuja|nigeria|port harcourt|ibadan|kano|₦|naira/i.test(brief)) Object.assign(raw, { gl: 'ng', country: 'Nigeria', currency: 'NGN' });

      // The order form's values are exact: they override what was read from the brief.
      const d = opts.details;
      let sellersIn: SellerIn[] = (Array.isArray(raw.sellers) ? raw.sellers : []).filter((s) => s && typeof s === 'object');
      if (d) {
        const lines = (d.items ?? '').split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s+/, '').trim()).filter(Boolean).slice(0, 5);
        if (lines.length) {
          const got = Array.isArray(raw.items) ? raw.items : [];
          raw.items = lines.map((line, i) => {
            const words = new Set(flat(line).split(' '));
            const it = got.length === lines.length ? got[i] : got.find((x) => flat(`${x?.name} ${x?.query}`).split(' ').filter((w) => words.has(w)).length >= 2);
            const name = stripQty(line);
            return { ...(it ?? { name, query: name, mustHave: [] }), qty: qtyOf(line) ?? it?.qty ?? 1 } as BP.Item;
          });
        }
        if (d.condition) for (const it of raw.items ?? []) it.condition = d.condition;
        raw.city = raw.city || [d.area, d.city].filter(Boolean).join(', ') || d.deliverTo || '';
        const local = raw.currency || (raw.gl === 'ng' ? 'NGN' : 'USD');
        if (d.budget) {
          const m = BP.money(d.budget, local), n = d.budget.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(k|m|million)?\b/i);
          raw.budget = m ?? (n ? { amount: Number(n[1]) * (/^k$/i.test(n[2] ?? '') ? 1e3 : n[2] ? 1e6 : 1), currency: local } : raw.budget);
        }
        const sl = (d.sellers ?? '').split('\n').map((l) => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
        sellersIn = sl.map((text, i) => {
          const s = sellersIn.length === sl.length ? sellersIn[i] : sellersIn.find((x) => x.text && (text.toLowerCase().includes(x.text.toLowerCase()) || x.text.toLowerCase().includes(text.toLowerCase())));
          return { ...(s ?? {}), text };
        });
      }
      const shop = BP.shopFrom(raw);
      if (d?.deliverTo) shop.where = [d.deliverTo, !d.deliverTo.toLowerCase().includes(shop.country.toLowerCase()) && shop.country].filter(Boolean).join(', ');
      const cur = shop.cur;
      const cc = shop.gl.toUpperCase();

      // 2-8. The best offers per item (the Best Price core: search, sort, price, open the pages, audit, rank)
      const p = await BP.findPrices(job, shop);
      const { results, found } = p;
      const label = (i: number) => BP.itemLabel(shop.items[i]);
      const itemsText = (is: number[]) => is.map(label).join(' and ');
      const fmt = (n?: number) => BP.fmt(n, cur);

      // 9. Which sellers to check: rules in code
      const sellers: Seller[] = [];
      const lowerBrief = brief.toLowerCase(), briefDigits = digits(brief);
      const toParsed = (s: SellerIn): VC.Parsed => ({
        name: s.name?.trim() || undefined, entity: s.entity === 'person' ? 'person' : 'company', country: cc, location: s.location ?? shop.city.split(',').pop()?.trim(), address: s.address ?? undefined,
        phone: s.phone ?? undefined, website: s.website ?? undefined, instagram: s.instagram ?? undefined, tiktok: s.tiktok ?? undefined, email: s.email ?? undefined,
        bankAccountName: s.bankAccountName ?? undefined, claimedYears: s.claimedYears ?? undefined, detailsChanged: !!s.detailsChanged, wantsSanctions: !!raw.wantsSanctions,
      });
      // A seller's own words: a form line as typed; from a free-text brief, only what is really in the brief.
      const sellerText = (s: SellerIn) => {
        if (s.text && (d?.sellers || lowerBrief.replace(/\s+/g, ' ').includes(s.text.toLowerCase().replace(/\s+/g, ' ')))) return s.text.trim();
        const ok = (x?: string | null) => !!x && (lowerBrief.includes(x.toLowerCase().replace(/^@/, '')) || (digits(x).length >= 9 && briefDigits.includes(digits(x).slice(-9))));
        return [s.name, s.instagram, s.phone, s.website, s.email, s.address].filter(ok).join(', ');
      };
      const distinct = (name: string) => flat(name).split(' ').filter((t) => t.length > 2 && !GENERIC.has(t));
      const sells = (v: VC.Payee, o: BP.Offer) => {
        const t = flat(`${o.title} ${o.seller} ${o.store ?? ''} ${o.snippet}`), core = distinct(v.name);
        return (!!v.domain && (o.host === v.domain || o.host.endsWith(`.${v.domain}`))) || (!!v.instagram && t.includes(flat(v.instagram)))
          || (!!v.phone && digits(`${o.snippet} ${o.excerpt ?? ''}`).includes(v.phone.nsn)) || (core.length > 0 && core.join('').length >= 4 && t.includes(flat(v.name)));
      };

      for (const [k, s] of sellersIn.entries()) {
        const text = sellerText(s);
        const parsed = toParsed(s);
        if (parsed.name && (/^@/.test(parsed.name) || !text.toLowerCase().includes(parsed.name.toLowerCase()))) parsed.name = undefined; // a handle is not a name; a name not in their words is a guess
        parsed.name ??= text.split(/[,;(]| - /)[0].replace(/^@\S+\s*(on instagram)?/i, '').trim() || undefined;
        const v = VC.settle(text, parsed);
        const seller: Seller = { name: v.name || text.slice(0, 40) || `Seller ${k + 1}`, text, listed: true, why: 'you listed them', src: s, parsed, v, items: [], theirs: [], stakeWhy: '' };
        if (!text || (!v.name && !v.phone && !v.host && !v.instagram)) { seller.skip = 'not enough to identify them: give a name plus a phone, website or Instagram handle'; seller.tag = 'not checked: not identified'; }
        else if (k >= MAX_LISTED) { seller.skip = `we check up to ${MAX_LISTED} of the sellers you list`; seller.tag = 'not checked: limit'; }
        else if (!v.phone && !v.instagram && !v.email && !v.acct && ['retailer', 'marketplace'].includes(BP.tierOf(v.name, v.host ?? ''))) {
          seller.skip = `it is a big retailer or marketplace, so pay through its own checkout or on delivery, never to a person or account that only uses its name`; seller.tag = 'not needed: big store';
        }
        seller.theirs = found.filter((o) => o.match === 'exact' && o.total !== undefined && sells(v, o));
        sellers.push(seller);
      }
      const skipped: { item: number; o: BP.Offer; why: string; tag: string }[] = [];
      results.forEach((r, i) => {
        const o = r.best;
        if (!o) return;
        const mine = sellers.find((s) => s.listed && !s.skip && sells(s.v, o));
        if (mine) { mine.items.push(i); return; }
        const shopName = BP.nameOf(o.host);
        if ((o.tier === 'marketplace' || o.tier === 'retailer') && !o.risk) {
          skipped.push({ item: i, o, why: o.tier === 'marketplace' ? `it is a ${shopName} store, so pay through ${shopName}'s own checkout or on delivery, never to the seller directly` : `${o.seller} is a known retailer, so pay on its own site, in its shop or on delivery`, tag: `not needed: ${o.tier === 'marketplace' ? `${shopName} store` : 'known retailer'}` });
          return;
        }
        const ad = o.tier === 'classifieds';
        const name = ad ? adSeller(o) : o.store ?? o.seller;
        const kind = ad ? `a classified ad on ${shopName}` : /whatsapp|instagram/i.test(o.excerpt ?? '') ? 'a seller taking orders on WhatsApp or Instagram' : o.risk ? `a shop whose page shows a warning sign (${o.risk})` : 'an online shop we don\'t know';
        if (!name) { skipped.push({ item: i, o, why: `it is ${kind} that doesn't name its seller, so ask for their name and shop address, inspect the item and pay only on collection`, tag: 'not checked: seller not named' }); return; }
        const same = sellers.find((s) => !s.listed && flat(s.name) === flat(name));
        if (same) { same.items.push(i); return; }
        const site = !ad && !BP.isGoogle(o.link) ? o.host : undefined;
        const text = [name, ad ? adPlace(o) : undefined, site, ad ? `(${shopName} ad)` : undefined].filter(Boolean).join(', ');
        const parsed: VC.Parsed = { name, entity: 'company', country: cc, location: ad ? adPlace(o) ?? shop.city : '', website: site, wantsSanctions: !!raw.wantsSanctions };
        sellers.push({ name, text, listed: false, why: `best pick for ${label(i)}: ${kind}`, parsed, v: VC.settle(text, parsed), items: [i], theirs: [], stakeWhy: '' });
      });

      // What each seller would be paid: their own quote, else the delivered total of what we'd buy from them, else the whole order
      for (const s of sellers) {
        const q = Number(s.src?.quoted?.amount) || 0; // kept only if the amount is really in their words
        const quoted = q > 0 && BP.moneyAll(s.text, cur).some((m) => Math.abs(m.amount - q) <= q * 0.005) ? q : undefined;
        const theirItems = [...new Set([...s.items, ...s.theirs.map((o) => o.item)])].sort();
        const offerFor = (i: number) => (s.items.includes(i) ? results[i].best! : s.theirs.filter((o) => o.item === i).sort((a, b) => a.total! - b.total!)[0]);
        const noFee = theirItems.some((i) => offerFor(i).delivery === undefined);
        if (quoted) { s.stake = quoted; s.stakeWhy = `${fmt(quoted)}, what they quoted`; }
        else if (theirItems.length) { s.stake = theirItems.reduce((a, i) => a + offerFor(i).total!, 0); s.stakeWhy = `${fmt(s.stake)}, ${s.theirs.length ? 'their price as we found it' : noFee ? 'the price' : 'the delivered total'} for ${itemsText(theirItems)}${noFee ? ', before delivery' : ''}`; }
        else if (p.basket !== undefined) { s.stake = p.basket; s.stakeWhy = `up to ${fmt(p.basket)}, the whole order (you didn't say what you'd buy from them)`; }
        else if (p.budgetLocal !== undefined) { s.stake = p.budgetLocal; s.stakeWhy = `up to ${fmt(p.budgetLocal)}, your budget`; }
        else s.stakeWhy = 'not known';
        s.parsed.amount = s.stake !== undefined ? Math.round(s.stake) : undefined;
        s.parsed.currency = cur;
        s.parsed.purpose = itemsText(theirItems.length ? theirItems : shop.items.map((_, i) => i));
        s.v = VC.settle(s.text, s.parsed);
      }

      // Cap and budget: whole checks first (listed sellers, then picks by what's at stake), then sanctions screens with what's left
      const queue = [...sellers.filter((s) => s.listed && !s.skip), ...sellers.filter((s) => !s.listed).sort((a, b) => (b.stake ?? 0) - (a.stake ?? 0))];
      let left = this.policy.budgetUsd - MAIL_BUDGET_USD - job.spentUsd();
      const planned: Seller[] = [];
      for (const s of queue) {
        const base = VC.checkCostUsd(s.v, { sanctions: false });
        if (planned.length >= MAX_CHECKS) { s.skip = `we check at most ${MAX_CHECKS} sellers per order and ${s.listed ? 'your first sellers came first' : 'the sellers you listed came first'}`; s.tag = 'not checked: limit'; }
        else if (base > left) { s.skip = 'the order\'s budget for checks was used up before this one'; s.tag = 'not checked: budget'; }
        else { left -= base; s.plannedUsd = base; planned.push(s); }
      }
      for (const s of planned.filter((x) => VC.sanctionsDue(x.v))) {
        if (VC.COST.aml <= left) { left -= VC.COST.aml; s.plannedUsd = (s.plannedUsd ?? 0) + VC.COST.aml; }
        else s.noSanctions = 'skipped because this order\'s budget for checks ran out before it (sellers higher on the list came first)';
      }
      job.log('investigator', 'plan', `checking ${planned.length ? planned.map((s) => `${s.name} (${s.listed ? 'listed' : 'pick'})`).join(', ') : 'no sellers'}${[...sellers.filter((s) => s.skip), ...skipped].length ? `; not checking ${[...sellers.filter((s) => s.skip).map((s) => s.name), ...skipped.map((x) => BP.who(x.o))].join(', ')}` : ''}; tools planned ≤ $${planned.reduce((a, s) => a + s.plannedUsd!, 0).toFixed(2)}`);

      // 10. The checks (the Check Before You Pay core), one seller at a time so the budget holds
      for (const s of planned) {
        job.log('investigator', 'check', `${s.name}: ${s.why}`);
        try { s.check = await VC.checkVendor(job, s.v, { sc: scenarioOf(s.text), sanctions: 'unless-red', noSanctions: s.noSanctions, softWords: true }); }
        catch (e: any) { s.failed = String(e?.message ?? e).slice(0, 160); job.log('investigator', 'skip', `${s.name}: ${s.failed}`); }
      }
      const checked = planned.filter((s) => s.check);

      // 11. Amounts the report may show: from the offers (the picks), plus the owner's own words, stakes and cited signals (the sellers)
      const priceOk = new Map<string, number[]>(), sellerOk = new Map<string, number[]>();
      const add = (m: Map<string, number[]>, c: string | undefined, n: number | undefined) => { if (c && n !== undefined && Number.isFinite(n)) m.set(c, [...(m.get(c) ?? []), Math.abs(n)]); };
      const both = (c: string | undefined, n: number | undefined) => { add(priceOk, c, n); add(sellerOk, c, n); };
      for (const o of found) {
        [o.unit, o.delivery, o.total].forEach((n) => both(cur, n));
        if (o.listed) both(o.listed.currency, o.listed.amount);
        if (typeof o.deliveryListed === 'object') both(o.deliveryListed.currency, o.deliveryListed.amount);
        for (const m of BP.moneyAll(`${o.title} ${o.notes.join(' ')}`, cur)) both(m.currency, m.amount);
      }
      results.forEach((r, i) => {
        [r.st.min, r.st.med, r.st.max, r.spread.min, r.spread.med, r.spread.max, r.typical].forEach((n) => both(cur, n));
        const mine = found.filter((o) => o.item === i && o.total !== undefined);
        for (const a of mine) {
          if (r.spread.med !== undefined && a.unit !== undefined) both(cur, r.spread.med - a.unit);
          for (const b of mine) both(cur, a.total! - b.total!);
        }
      });
      [p.basket, p.budgetLocal, p.basket !== undefined && p.budgetLocal !== undefined ? p.budgetLocal - p.basket : undefined].forEach((n) => both(cur, n));
      if (shop.budget) both(shop.budget.currency, shop.budget.amount);
      for (const [c, rate] of p.fx) { both(cur, rate); both(c, 1); }
      for (const s of sellers) { add(sellerOk, cur, s.stake); add(sellerOk, 'USD', s.v.amountUsd); }
      add(sellerOk, 'USD', 500);
      for (const m of BP.moneyAll(`${brief}\n${d ? Object.values(d).join('\n') : ''}`, cur)) add(sellerOk, m.currency, m.amount);
      for (const s of checked) for (const g of s.check!.signals) for (const m of BP.moneyAll(`${g.check} ${g.finding}`, cur)) add(sellerOk, m.currency, m.amount);
      // shown amounts are rounded to whole units (naira, or anything from 100,000 up) or to cents
      const untraced = (t: string, ok: Map<string, number[]>) => BP.moneyAll(t, cur).filter((m) => !(ok.get(m.currency) ?? []).some((a) => Math.abs(a - m.amount) <= (BP.WHOLE.has(m.currency) || a >= 1e5 ? 1 : 0.011))).map(BP.fmtM);
      const RULE = /\b(R[1-8]|A10|A[1-9]|G1)\b/g;

      // The Writer's words for each seller pass the same checks, or the rule-based text replaces them
      const notes: string[] = [];
      for (const s of checked) {
        const c = s.check!, rules = new Set([...VC.ruleIds([...c.reds, ...c.ambers]), 'G1']);
        const fine = (t: string) => !untraced(t, sellerOk).length && [...t.matchAll(RULE)].every((m) => rules.has(m[1]));
        const fb = VC.fallbackWords(c.verdict, [...c.reds, ...c.ambers], c.v.name);
        if (!fine(c.summary)) { c.summary = fb.summary; notes.push(`${s.name}: summary replaced by the rule-based text (it named an amount or rule we could not trace)`); }
        const qs = c.questions.filter(fine);
        if (qs.length < c.questions.length) notes.push(`${s.name}: ${c.questions.length - qs.length} question(s) dropped (untraceable amount or rule)`);
        c.questions = qs.length >= 3 ? qs : fb.questions;
        c.tips = c.tips.filter(fine);
      }

      // 12. The report
      job.log('writer', 'report', 'picks with delivered totals, the sellers to check before paying, honest limits');
      const tagFor = (i: number) => {
        const s = sellers.find((x) => x.items.includes(i));
        if (s?.check) return `**${s.check.verdict}** (see below)`;
        if (s) return s.tag ?? (s.failed ? 'not checked: the check failed' : 'not checked');
        return skipped.find((x) => x.item === i)?.tag ?? '—';
      };
      const head = [
        `# Buy Smart: ${shop.items.map((_, i) => label(i)).join(', ')}`,
        `${d?.name ? `For ${d.name} · d` : 'D'}elivered to ${shop.where || cc} · all prices in ${cur} · checked ${p.date}`,
        ...(p.md.basket ? [p.md.basket] : []),
        ...(checked.length ? [`**Before you pay:** ${checked.map((s) => `${s.name} is **${s.check!.verdict}** (${VC.VERDICT[s.check!.verdict].replace(/^\w/, (c) => c.toLowerCase())})`).join(' · ')}. Details below.`] : []),
        `| Item | Best pick | Delivered total | Seller check | Runner-up | Delivered total |\n|---|---|---|---|---|---|\n` + results.map((r, i) =>
          `| ${BP.cell(label(i))} | ${r.best ? BP.cell(BP.who(r.best)) : 'none found'} | ${fmt(r.best?.total)} | ${tagFor(i)} | ${r.runner ? BP.cell(BP.who(r.runner)) : '—'} | ${fmt(r.runner?.total)} |`).join('\n'),
      ].join('\n\n');
      const checkLine = (i: number) => {
        const s = sellers.find((x) => x.items.includes(i)), sk = skipped.find((x) => x.item === i);
        if (s?.check) return `**Seller check: ${s.check.verdict}** (${VC.VERDICT[s.check.verdict].replace(/^\w/, (c) => c.toLowerCase())}). See "Before you pay".`;
        if (s) return `**Seller check:** not done (${s.failed ? 'the check failed' : s.skip}). Treat them as unverified.`;
        return sk ? `**Seller check:** ${sk.tag.startsWith('not needed') ? 'not needed' : 'not done'}; ${sk.why}.` : '';
      };
      // where haggling is normal (classified ads, Instagram and WhatsApp sellers, small shops), a price to open at:
      // the lowest real price we found for it (scam-flagged prices are already out of the spread)
      const haggle = (i: number) => {
        const r = results[i], b = r.best;
        if (!b || b.unit === undefined || (b.tier !== 'classifieds' && b.tier !== 'unknown')) return '';
        const low = r.spread.min;
        return low !== undefined && low < b.unit * 0.98 ? `**Price to offer:** this seller will usually haggle. Open at ${fmt(low)} (the lowest real price we found for it) and don't go above ${fmt(b.unit)} each.` : `**Price to offer:** this is already the lowest real price we found, so ask for free delivery instead of a discount.`;
      };
      const picks = ['## The picks', ...p.md.items.map((x, i) => [`### ${x.heading}`, x.body.trim(), checkLine(i), haggle(i)].filter(Boolean).join('\n\n'))].join('\n\n');
      const arrives = ['## When it arrives: check before you pay', 'Pay on delivery where you can, and only after these checks. If anything fails, don\'t accept it.', ...shop.items.map((it, i) => `**${label(i)}**\n\n${inspectList(it.name, it.condition).map((x) => `- [ ] ${x}`).join('\n')}`)].join('\n\n');
      const offerWarnings = ['## Warnings about the offers', p.md.warnings.join('\n')].join('\n\n');

      const ids = (s: Seller) => [s.v.instagram && `@${s.v.instagram}`, s.v.phone?.local, s.v.domain ?? s.v.host, s.v.address].filter(Boolean).join(', ');
      const whoLines = [
        ...sellers.map((s) => {
          const also = s.listed && s.theirs.length ? `; we also found their offer for ${[...new Set(s.theirs.map((o) => o.item))].map((i) => `${label(i)} at ${fmt(Math.min(...s.theirs.filter((o) => o.item === i).map((o) => o.unit!)))} each`).join(' and ')}` : '';
          const pickOf = s.listed && s.items.length ? `; also the best pick for ${itemsText(s.items)}` : '';
          return `- **${s.name}**${ids(s) ? ` (${ids(s)})` : ''}: ${s.why}${pickOf}${also}. ${s.check ? 'Checked.' : s.failed ? `Not checked: the check failed (${s.failed}).` : `Not checked: ${s.skip}.`}`;
        }),
        ...skipped.map((x) => `- **${BP.who(x.o)}**, best pick for ${label(x.item)}: not checked; ${x.why}.`),
      ];
      const sellerSections = checked.map((s, k) => {
        const c = s.check!, shown = c.signals.filter((g) => g.level !== 'skip');
        return [
          `### ${k + 1}. ${s.name}`,
          `> **${c.verdict} · ${VC.VERDICT[c.verdict]}**\n>\n> ${s.listed ? 'You listed them' : `Best pick for ${itemsText(s.items)}`}${ids(s) ? ` (${ids(s)})` : ''}. At stake: ${s.stakeWhy}.\n> **Rule${c.fired.length > 1 ? 's' : ''} that fired:** ${c.fired.join(' · ')}\n> ${shown.length} signals · ${c.reds.length} red, ${c.ambers.length} amber, ${c.groups.length} independent positive${c.groups.length === 1 ? '' : 's'}`,
          c.summary,
          ['| Area | Check | What we found | Signal | Source |', '|---|---|---|---|---|', ...VC.sortSignals(shown).map(VC.signalRow)].join('\n'),
          ...(c.reds.length + c.ambers.length ? [`**Flags explained**\n\n${VC.flagLines(c).join('\n')}`] : []),
          `**Ask them before paying**\n\n${c.questions.map((x, i) => `${i + 1}. ${x}`).join('\n')}`,
          ...(c.verdict === 'RED' || c.tips.length ? [`**Paying them**\n\n${[...(c.verdict === 'RED' ? [VC.payAdvice('RED', c.v.entity)[0]] : []), ...c.tips].map((x) => `- ${x}`).join('\n')}`] : []),
        ].join('\n\n');
      });
      const before = [
        '## Before you pay',
        `**Who we checked, and why.** ${SELLER_RULES}`,
        whoLines.length ? whoLines.join('\n') : '- You didn\'t list any sellers, and every best pick is from a big retailer or marketplace store.',
        ...sellerSections,
        `**However you pay any of them:**\n\n${VC.payAdvice('AMBER', 'company').map((x) => `- ${x}`).join('\n')}`,
      ].join('\n\n');

      const notGiven = (s: Seller) => [!s.v.phone && !s.v.phoneRaw && 'phone', !s.v.host && 'website', !s.v.instagram && 'Instagram handle', !s.v.address && 'shop address', !s.v.acct && 'bank account name'].filter(Boolean).join(', ');
      const limits = [
        '## Honest limits',
        [
          ...checked.map((s) => `- **${s.name}:** ${[...s.check!.gaps, ...(s.listed && notGiven(s) ? [`Not given, so not checked: ${notGiven(s)}`] : [])].map((g) => g.replace(/\.$/, '')).join('. ')}.`),
          ...sellers.filter((s) => !s.check && !s.tag?.startsWith('not needed')).map((s) => `- **${s.name}** was not checked (${s.failed ? 'the check failed' : s.skip}). Treat them as unverified: pay on delivery or after you inspect the goods.`),
          '- Runner-ups and the other offers in the tables were not checked as sellers. If you switch to one from a classified ad or a shop we don\'t know, check it first.',
          '- For shops we found ourselves, we checked the business behind the website or ad, not a phone number on it.',
          '- Who owns a bank account: no public source confirms it. Before you confirm a transfer, check that the account name your bank shows matches the business.',
          '- Prices, stock and delivery fees change quickly: confirm them at checkout.',
          '- These are signals, not proof. RED means high risk, not that anyone has committed fraud; GREEN can\'t rule fraud out.',
        ].join('\n'),
      ].join('\n\n');
      const method = [
        '## How we checked',
        [p.md.method.trim(), `- **Which sellers we checked.** ${SELLER_RULES}`, '- **Seller verdicts** come from fixed rules in code, not from an AI\'s opinion:', ...VC.VERDICT_RULES.map((x) => `  ${x}`)].join('\n'),
        '_Every offer we found is in `offers.csv`; every seller signal, with its source, is in `buy-smart-signals.json`._',
      ].join('\n\n');
      const md = [head, picks, before, offerWarnings, arrives, limits, method].join('\n\n') + '\n';

      // 13. QA: both cores' checks, then the merged report
      const issues: string[] = [];
      const badPrice = untraced([head, picks, offerWarnings].join('\n'), priceOk);
      if (badPrice.length) issues.push(`price(s) not from an offer we found: ${[...new Set(badPrice)].join(', ')}`);
      const badSeller = untraced([before, limits].join('\n'), sellerOk);
      if (badSeller.length) issues.push(`amount(s) in the seller checks we can't trace: ${[...new Set(badSeller)].join(', ')}`);
      checked.forEach((s, k) => {
        const c = s.check!, sec = sellerSections[k];
        if (VC.verdictOf(c.signals).verdict !== c.verdict || !sec.includes(`**${c.verdict} · ${VC.VERDICT[c.verdict]}**`)) issues.push(`${s.name}: the verdict shown is not the rules' verdict`);
        const rules = new Set([...VC.ruleIds([...c.reds, ...c.ambers]), 'G1']), stray = [...new Set([...sec.matchAll(RULE)].map((m) => m[1]).filter((r) => !rules.has(r)))];
        if (stray.length) issues.push(`${s.name}: cites rule ${stray.join(', ')}, which did not fire`);
      });
      for (const s of sellers) if (!before.includes(`**${s.name}**`)) issues.push(`${s.name} is missing from "Before you pay"`);
      if (checked.length > MAX_CHECKS) issues.push(`${checked.length} seller checks, over the cap of ${MAX_CHECKS}`);
      if (job.spentUsd() > this.policy.budgetUsd - MAIL_BUDGET_USD + 1e-9) issues.push(`tools cost $${job.spentUsd().toFixed(3)}, over the plan`);
      const vendorQa = checked.filter((s) => s.check!.qa.verdict === 'revise').map((s) => `${s.name}: ${s.check!.qa.notes}`);
      const hardFail = p.bugs.length > 0 || (results.every((r) => !r.best) && !checked.length);
      const allNotes = [...p.bugs, ...p.notes, ...vendorQa, ...issues, ...notes];
      job.log('auditor', 'check', hardFail || issues.length || vendorQa.length ? allNotes.join('; ') : `pass: every amount traced, ${checked.length} verdict${checked.length === 1 ? '' : 's'} from the rules${allNotes.length ? ` (note: ${allNotes.join('; ')})` : ''}`);
      job.qa = {
        verdict: hardFail || issues.length || vendorQa.length || p.qa.verdict === 'revise' ? 'revise' : 'pass',
        notes: [p.qa.notes, ...checked.map((s) => `${s.name}: ${s.check!.qa.notes}`), ...issues, ...notes].filter(Boolean).join(' | '),
        model: `${p.auditRan ? `${MODELS.auditor} + ` : ''}deterministic rules`,
      };

      job.deliverable = md;
      job.files.push({ name: 'offers.csv', content: p.csv });
      job.files.push({
        name: 'buy-smart-signals.json',
        content: JSON.stringify({
          service: 'buy-smart', checkedAt: new Date().toISOString(), currency: cur, sellerRules: SELLER_RULES, verdictRules: VC.VERDICT_RULES,
          sellers: sellers.map((s) => ({
            name: s.name, listed: s.listed, why: s.why, text: s.text, items: s.items.map(label), atStake: s.stake === undefined ? null : Math.round(s.stake), atStakeWhy: s.stakeWhy,
            checked: !!s.check, notChecked: s.check ? undefined : s.failed ?? s.skip,
            ...(s.check ? { verdict: s.check.verdict, rulesFired: s.check.fired, positiveGroups: s.check.groups, signals: s.check.signals, notCheckedSignals: s.check.gaps, raw: s.check.raw } : {}),
          })),
          picksNotChecked: skipped.map((x) => ({ item: label(x.item), seller: BP.who(x.o), link: x.o.link, why: x.why })),
        }, null, 2) + '\n',
      });
      job.status = hardFail ? 'failed' : 'delivered';
      if (hardFail) job.error = `QA failed: ${[...p.bugs, ...p.notes].join('; ')}`;
    } catch (e: any) {
      job.status = 'failed';
      job.error = String(e?.message ?? e);
      console.error('  ✗', job.error);
    }
    job.save();
    return job;
  },
};
