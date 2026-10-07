'use client';
// The business form: who you are, how customers reach you, what you sell (with your own photos), and what
// this job needs. Two to four short steps per service, saved as one draft on this device so nothing is typed twice.
// Photos are shrunk in the browser before upload, so it stays quick on mobile data.
import { useEffect, useState } from 'react';

export type Details = {
  name: string; kind: string; offer: string; area: string; city: string;
  whatsapp: string; phone: string; email: string; address: string; maps: string;
  instagram: string; tiktok: string; facebook: string; website: string;
  links: string; bankName: string; bankNumber: string; bankAccountName: string;
  menu: string; story: string; style: string; colour: string; sections: string[]; notes: string;
  logo?: string; photos: string[];
  platforms: string[]; goal: string; competitors: string; tone: string;
  promote: string; price: string; cta: string; format: string; length: number; questions: string; searches: string;
  adGoal: string; adBudget: string; adPlatforms: string[]; audience: string; adResults: string[];
  product: string; uses: string[]; look: string;
  items: string; deliverTo: string; budget: string; condition: string; sellers: string;
  flyerKind: string; statements: string[]; research: string;
};

const KINDS: [string, string][] = [['food', 'Food & drinks'], ['beauty', 'Beauty & wellness'], ['creative', 'Photography & creative'], ['events', 'Events & weddings'], ['retail', 'Shop & products'], ['health', 'Health & clinics'], ['professional', 'Professional services'], ['other', 'Something else']];
// Mirrors server/src/site/themes.ts (ids must match).
const THEMES: { id: string; name: string; mood: string; font: string; bg: string; ink: string; italic?: boolean; caps?: boolean }[] = [
  { id: 'atelier', name: 'Editorial', mood: 'Warm serif, cream paper', font: "'Fraunces', serif", bg: '#FBF5EC', ink: '#2A1A10', italic: true },
  { id: 'street', name: 'Bold', mood: 'Loud, heavy, youthful', font: "'Archivo', sans-serif", bg: '#FFFFFF', ink: '#111111', caps: true },
  { id: 'salon', name: 'Elegant', mood: 'Fine serif, airy, soft', font: "'Cormorant Garamond', serif", bg: '#FBF8F6', ink: '#2B2320', italic: true },
  { id: 'studio', name: 'Minimal', mood: 'Photo-first, sharp edges', font: "'Space Grotesk', sans-serif", bg: '#F6F6F4', ink: '#141414' },
  { id: 'clinic', name: 'Calm', mood: 'Clear, trustworthy', font: "'Literata', serif", bg: '#F4F8FA', ink: '#14212B' },
  { id: 'market', name: 'Playful', mood: 'Round, bright, friendly', font: "'Unbounded', sans-serif", bg: '#FFF8E8', ink: '#1E1A10' },
  { id: 'lounge', name: 'Dark luxe', mood: 'Night-time, refined', font: "'Fraunces', serif", bg: '#17120F', ink: '#F4EDE4', italic: true },
];
const SECTIONS: [string, string][] = [['offer', 'Menu / prices'], ['gallery', 'Photo gallery'], ['reviews', 'Google reviews'], ['about', 'About us'], ['steps', 'How to order or book'], ['location', 'Map & opening hours'], ['faq', 'Questions & answers']];
const SWATCHES = ['#C0392B', '#D4380D', '#E67E22', '#D4A017', '#2E7D32', '#0F766E', '#1D4ED8', '#6D28D9', '#BE185D', '#111827'];
const EMPTY: Details = { name: '', kind: 'food', offer: '', area: '', city: 'Lagos', whatsapp: '', phone: '', email: '', address: '', maps: '', instagram: '', tiktok: '', facebook: '', website: '', links: '', bankName: '', bankNumber: '', bankAccountName: '', menu: '', story: '', style: 'auto', colour: '', sections: SECTIONS.map(([k]) => k), notes: '', photos: [], platforms: ['instagram', 'tiktok'], goal: '', competitors: '', tone: '', promote: '', price: '', cta: 'whatsapp', format: 'vertical', length: 16, questions: '', searches: '', adGoal: 'messages', adBudget: '', adPlatforms: ['meta'], audience: '', adResults: [], product: '', uses: ['instagram', 'whatsapp'], look: 'clean', items: '', deliverTo: '', budget: '', condition: 'new', sellers: '' , flyerKind: 'promo', statements: [] , research: '' };
const PLATFORMS: [string, string][] = [['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['whatsapp-status', 'WhatsApp Status'], ['facebook', 'Facebook'], ['x', 'X'], ['linkedin', 'LinkedIn']];
const GOALS = ['More orders this month', 'More bookings', 'More followers who buy', 'Launch a new product', 'Fill quiet weekdays'];
const TONES = ['Warm and friendly', 'Playful, Lagos street', 'Premium and calm', 'Bold and loud', 'Expert and trustworthy'];
const CTAS: [string, string][] = [['whatsapp', 'Order on WhatsApp'], ['call', 'Call us'], ['dm', 'DM on Instagram'], ['website', 'Order on our website'], ['visit', 'Visit the shop']];
const AD_GOALS: [string, string][] = [['messages', 'WhatsApp or DM messages'], ['sales', 'Website sales'], ['calls', 'Phone calls'], ['visits', 'Shop visits'], ['followers', 'Followers']];
const AD_PLATFORMS: [string, string][] = [['meta', 'Instagram & Facebook'], ['tiktok', 'TikTok']];
const USES: [string, string][] = [['instagram', 'Instagram'], ['whatsapp', 'WhatsApp catalogue & Status'], ['marketplace', 'Jumia, Jiji, Konga'], ['website', 'Website']];
const LOOKS: [string, string][] = [['clean', 'Clean studio'], ['lifestyle', 'Real-life scenes'], ['bold', 'Bold colour']];
type StepId = 'business' | 'contact' | 'links' | 'offer' | 'look' | 'content' | 'ad' | 'plan' | 'audit' | 'shots' | 'buy' | 'flyer' | 'statement';
const FLOWS: Record<string, { id: StepId; title: string }[]> = {
  website: [{ id: 'business', title: 'Your business' }, { id: 'contact', title: 'Contact & links' }, { id: 'offer', title: 'What you sell' }, { id: 'look', title: 'The look' }],
  'content-pack': [{ id: 'business', title: 'Your business' }, { id: 'links', title: 'Your accounts' }, { id: 'content', title: 'The content' }],
  'motion-ad': [{ id: 'business', title: 'Your business' }, { id: 'ad', title: 'The ad' }],
  'ad-launch': [{ id: 'business', title: 'Your business' }, { id: 'ad', title: 'The offer' }, { id: 'plan', title: 'Budget & goal' }],
  'product-photos': [{ id: 'business', title: 'Your business' }, { id: 'shots', title: 'Your photos' }],
  'get-found': [{ id: 'business', title: 'Your business' }, { id: 'audit', title: 'Your market' }],
  'buy-smart': [{ id: 'business', title: 'Your business' }, { id: 'buy', title: 'What to buy' }],
  flyers: [{ id: 'business', title: 'Your business' }, { id: 'flyer', title: 'The flyer' }],
  'money-report': [{ id: 'business', title: 'Your business' }, { id: 'statement', title: 'Your statement' }],
};
const FLYER_KINDS: [string, string][] = [['promo', 'Promo flyer'], ['pricelist', 'Price list or menu'], ['announcement', 'Announcement']];

/** Bank statements go to their own private store (never the public photo uploads). The password, if any, is used
 *  once on the server to read the PDF and is not kept. */
async function uploadStatements(files: File[], password: string): Promise<{ id: string; name: string; kind: string; pages?: number }[]> {
  const fd = new FormData();
  for (const f of files) fd.append('file', f.type.startsWith('image/') ? await shrink(f) : f, f.name);
  if (password.trim()) fd.append('password', password.trim());
  const r = await fetch('/api/statements', { method: 'POST', body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? 'Upload failed');
  return j.statements;
}
const KEY = 'syncly:business';

/** Save a business (e.g. from an earlier order) as this device's draft, so the next order starts with it. */
export function saveBusiness(details: Record<string, unknown>) {
  try {
    const was = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const bank = details.bank as { bank?: string; accountNumber?: string; accountName?: string } | undefined;
    const { bank: _b, ...rest } = details;
    const d = { ...rest, competitors: Array.isArray(details.competitors) ? (details.competitors as string[]).join(' ') : details.competitors, links: Array.isArray(details.links) ? (details.links as string[]).join('\n') : details.links, ...(bank ? { bankName: bank.bank, bankNumber: bank.accountNumber, bankAccountName: bank.accountName } : {}) };
    localStorage.setItem(KEY, JSON.stringify({ ...EMPTY, ...was, ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined && v !== null)) }));
  } catch {}
}

/** Shrink a photo to at most 2000 px and re-encode it as JPEG before upload. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise<Blob>((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error('encode'))), 'image/jpeg', 0.86));
  } catch { return file; }
}
export async function upload(files: File[]): Promise<string[]> {
  const fd = new FormData();
  for (const f of files) fd.append('file', await shrink(f), f.name.replace(/\.\w+$/, '.jpg'));
  const r = await fetch('/api/uploads', { method: 'POST', body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? 'Upload failed');
  return j.uploads.map((u: { id: string }) => u.id);
}

export default function BusinessForm({ service, onSubmit, busy, email, setEmail, cta }: { service: string; onSubmit: (d: Details) => void; busy: boolean; email: string; setEmail: (v: string) => void; cta: string }) {
  const [d, setD] = useState<Details>(EMPTY);
  const [step, setStep] = useState(0);
  // A business saved on this device (an earlier order): start from the service's own questions.
  const [saved, setSaved] = useState(false);
  const [up, setUp] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false); // the draft is loaded; only then is it saved back
  const [stmts, setStmts] = useState<{ id: string; name: string; kind: string; pages?: number }[]>([]);
  const [pw, setPw] = useState('');
  async function addStatements(list: FileList | null) {
    if (!list?.length) return;
    setErr(null); setUp('statements');
    try { const got = await uploadStatements([...list].slice(0, 6 - stmts.length), pw); const all = [...stmts, ...got].slice(0, 6); setStmts(all); set('statements', all.map((x) => x.id)); }
    catch (e: any) { setErr(e.message); } finally { setUp(null); }
  }
  useEffect(() => { try { const s = localStorage.getItem(KEY); if (s) { const x = { ...EMPTY, ...JSON.parse(s), statements: [] }; setD(x); setSaved(!!(x.name?.trim() && x.offer?.trim())); } } catch {} setReady(true); }, []);
  useEffect(() => { if (ready) try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} }, [d, ready]);
  const set = <K extends keyof Details>(k: K, v: Details[K]) => setD((x) => ({ ...x, [k]: v }));
  const text = (k: keyof Details | '_pw', label: string, ph: string, hint?: string, type = 'text') => (
    <label className="field">{label}{hint && <span className="hint">{hint}</span>}<input type={type} autoComplete={k === '_pw' ? 'off' : undefined} value={k === '_pw' ? pw : (d[k] as string)} onChange={(e) => (k === '_pw' ? setPw(e.target.value) : set(k, e.target.value as never))} placeholder={ph} /></label>
  );
  async function addPhotos(list: FileList | null, to: 'photos' | 'logo' | 'adResults' = 'photos') {
    if (!list?.length) return;
    setErr(null); setUp(to);
    try {
      const max = to === 'logo' ? 1 : to === 'adResults' ? 4 - d.adResults.length : 10 - d.photos.length;
      const ids = await upload([...list].filter((f) => f.type.startsWith('image/')).slice(0, max));
      if (to === 'logo') set('logo', ids[0]); else if (to === 'adResults') set('adResults', [...d.adResults, ...ids].slice(0, 4)); else set('photos', [...d.photos, ...ids].slice(0, 10));
    } catch (e: any) { setErr(e.message); } finally { setUp(null); }
  }

  const reach = !!(d.whatsapp.trim() || d.phone.trim() || d.email.trim());
  const ctaReady = d.cta === 'whatsapp' || d.cta === 'call' ? !!(d.whatsapp.trim() || d.phone.trim()) : d.cta === 'dm' ? !!d.instagram.trim() : d.cta === 'website' ? !!d.website.trim() : d.cta === 'visit' ? !!d.address.trim() : true;
  const valid: Record<StepId, boolean> = {
    business: !!(d.name.trim() && d.offer.trim() && (service !== 'get-found' || d.city.trim() || d.area.trim())),
    contact: reach, links: true, offer: true, look: true, content: d.platforms.length > 0, ad: !!(d.promote.trim() && ctaReady), audit: true,
    plan: d.adPlatforms.length > 0, shots: d.photos.length > 0, buy: !!(d.items.trim() && (d.deliverTo.trim() || d.city.trim() || d.area.trim())),
    flyer: (d.flyerKind === 'pricelist' ? !!d.menu.trim() : !!d.promote.trim()) && !!(d.whatsapp.trim() || d.phone.trim() || d.instagram.trim() || d.website.trim() || d.address.trim()),
    statement: d.statements.length > 0,
  };
  const why: Partial<Record<StepId, string>> = {
    business: service === 'get-found' ? 'Add the business name, what you sell, and the area or city.' : 'Add the business name and what you sell.',
    contact: 'Add at least one way customers can reach you.', content: 'Pick at least one platform.',
    ad: !d.promote.trim() ? 'Say what the ad is for.' : 'Add the contact detail for your call to action.',
    flyer: d.flyerKind === 'pricelist' && !d.menu.trim() ? 'Add your items and prices.' : !d.promote.trim() && d.flyerKind !== 'pricelist' ? 'Say what the flyer is for.' : 'Add how customers reach you.',
    statement: 'Upload your bank statement.',
    plan: 'Pick where the ads should run.', shots: 'Add at least one photo of the product.', buy: !d.items.trim() ? 'List what you want to buy.' : 'Add where it should be delivered.',
  };
  const skip = (id: StepId) => saved && ((id === 'business' && valid.business) || (id === 'contact' && valid.contact));
  const flow = (FLOWS[service] ?? FLOWS.website).filter((f) => !skip(f.id));
  const cur = flow[Math.min(step, flow.length - 1)].id;
  const last = step >= flow.length - 1;
  const allValid = flow.every((f) => valid[f.id]) && email.includes('@');

  const photosField = (hint: string, max = 10) => (
    <div className="field">Your photos <span className="hint">{hint}</span>
      <div className="uploads">
        {d.photos.map((id) => <figure key={id}><img src={`/api/uploads/${id}`} alt="" /><button type="button" aria-label="Remove" onClick={() => set('photos', d.photos.filter((x) => x !== id))}>×</button></figure>)}
        {d.photos.length < max && <label className="addph">{up === 'photos' ? 'Uploading…' : '+ Add photos'}<input type="file" accept="image/*" multiple onChange={(e) => addPhotos(e.target.files)} hidden /></label>}
      </div>
    </div>
  );
  const logoField = (hint: string) => (
    <div className="field">Logo <span className="hint">{hint}</span>
      <div className="uploads">
        {d.logo && <figure className="logo"><img src={`/api/uploads/${d.logo}`} alt="" /><button type="button" aria-label="Remove" onClick={() => set('logo', undefined)}>×</button></figure>}
        {!d.logo && <label className="addph">{up === 'logo' ? 'Uploading…' : '+ Add logo'}<input type="file" accept="image/*" onChange={(e) => addPhotos(e.target.files, 'logo')} hidden /></label>}
      </div>
    </div>
  );
  const colourField = (autoLabel = 'From my photos') => (
    <div className="field">Colour
      <div className="swatches">
        <button type="button" className={`sw auto${!d.colour ? ' on' : ''}`} onClick={() => set('colour', '')}>{autoLabel}</button>
        {SWATCHES.map((c) => <button type="button" key={c} className={`sw${d.colour.toLowerCase() === c.toLowerCase() ? ' on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => set('colour', c)} />)}
        <label className="sw pick" title="Your exact brand colour"><input type="color" value={d.colour || '#2E7A38'} onChange={(e) => set('colour', e.target.value)} />Pick</label>
      </div>
    </div>
  );
  const chips = (k: 'platforms' | 'adPlatforms' | 'uses', options: [string, string][]) => (
    <div className="checks">{options.map(([v, l]) => <label key={v} className={`chip click${d[k].includes(v) ? ' on' : ''}`}><input type="checkbox" hidden checked={d[k].includes(v)} onChange={(e) => set(k, e.target.checked ? [...d[k], v] : d[k].filter((x) => x !== v))} />{l}</label>)}</div>
  );
  const pick = (k: 'goal' | 'tone' | 'cta' | 'format' | 'adGoal' | 'look' | 'condition' | 'flyerKind', options: [string, string][]) => (
    <div className="checks">{options.map(([v, l]) => <button type="button" key={v} className={`chip click${d[k] === v ? ' on' : ''}`} onClick={() => set(k, v)}>{l}</button>)}</div>
  );
  const notes = (hint: string) => <label className="field">Anything else <span className="hint">{hint}</span><textarea style={{ minHeight: 80 }} value={d.notes} onChange={(e) => set('notes', e.target.value)} /></label>;
  const emailHint: Record<string, string> = { flyers: 'We send your flyers here.', 'money-report': 'We send the private link to your report here, and only here.', website: 'We send the finished site here.', 'content-pack': 'We send your content pack here.', 'motion-ad': 'We send your motion ad here.', 'ad-launch': 'We send your ads and the plan here.', 'product-photos': 'We send your photos here.', 'get-found': 'We send the report here.', 'buy-smart': 'We send the best offers and the seller checks here.' };

  return (
    <div className="bform">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@1,500&family=Archivo:wdth,wght@125,850&family=Cormorant+Garamond:ital,wght@1,500&family=Space+Grotesk:wght@500&family=Literata:wght@600&family=Unbounded:wght@700&display=swap" />
      {saved && (
        <div className="savedbiz">
          {d.logo ? <img src={`/api/uploads/${d.logo}`} alt="" /> : <span className="initial">{d.name.trim().slice(0, 1)}</span>}
          <div><span className="mono">Ordering for</span><b>{d.name}</b><span className="muted">{[KINDS.find(([k]) => k === d.kind)?.[1], [d.area, d.city].filter(Boolean).join(', '), d.whatsapp || d.phone, d.instagram && `@${d.instagram.replace(/^@/, '')}`].filter(Boolean).join(' · ')}</span></div>
          <div className="acts">
            <button type="button" className="linkbtn" onClick={() => { setSaved(false); setStep(0); }}>Edit details</button>
            <button type="button" className="linkbtn" onClick={() => { setD(EMPTY); setSaved(false); setStep(0); }}>New business</button>
          </div>
        </div>
      )}
      <ol className="bsteps" style={{ gridTemplateColumns: `repeat(${flow.length}, 1fr)` }}>{flow.map((f, i) => <li key={f.id} className={i === step ? 'on' : i < step ? 'done' : ''}><button type="button" onClick={() => setStep(i)}><span>{i + 1}</span>{f.title}</button></li>)}</ol>

      {cur === 'business' && (
        <div className="form">
          {text('name', 'Business name', 'Tolu’s Small Chops')}
          <label className="field">What kind of business
            <select value={d.kind} onChange={(e) => set('kind', e.target.value)}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          {text('offer', 'What you sell, in one line', 'Small chops trays and party catering for events across Lagos')}
          <div className="two-up">{text('area', 'Area', 'Surulere')}{text('city', 'City', 'Lagos')}</div>
        </div>
      )}

      {cur === 'contact' && (
        <div className="form">
          <div className="two-up">{text('whatsapp', 'WhatsApp number', '0803 555 0142', undefined, 'tel')}{text('phone', 'Phone (if different)', '', undefined, 'tel')}</div>
          {text('address', 'Address', '14 Adelabu Street, Surulere, Lagos', 'Leave it out if you don’t have a shop or office customers visit.')}
          {text('maps', 'Google Maps link', 'https://maps.app.goo.gl/…', 'If you’re on Google Maps, we pull your hours and real reviews from it.', 'url')}
          <div className="two-up">{text('instagram', 'Instagram', '@yourbusiness')}{text('tiktok', 'TikTok', '@yourbusiness')}</div>
          <div className="two-up">{text('facebook', 'Facebook page', 'yourbusiness')}{text('website', 'Current website', 'yourbusiness.com')}</div>
          {text('email', 'Business email (shown on the site)', 'hello@yourbusiness.com', undefined, 'email')}
          <label className="field">Where customers already order, book or pay <span className="hint">Optional. Paste your Chowdeck, Glovo, Heyfood, Paystack, Selar, Bumpa, Fresha, Calendly or Tix link, one per line. Each becomes a button on your site, and we bring in your Chowdeck menu and prices.</span>
            <textarea style={{ minHeight: 76 }} value={d.links} onChange={(e) => set('links', e.target.value)} placeholder={'https://chowdeck.com/store/…\nhttps://paystack.shop/…'} />
          </label>
          <div className="two-up">{text('bankName', 'Bank, for transfers', 'Moniepoint, OPay, GTBank…', 'Optional. Shown with a copy button.')}{text('bankNumber', 'Account number', '10 digits', ' ')}</div>
          {d.bankNumber.trim() && text('bankAccountName', 'Account name', 'As it shows on the transfer')}
        </div>
      )}

      {cur === 'links' && (
        <div className="form">
          <div className="two-up">{text('instagram', 'Instagram', '@yourbusiness', 'We study what your posts get.')}{text('tiktok', 'TikTok', '@yourbusiness')}</div>
          <div className="two-up">{text('website', 'Website', 'yourbusiness.com')}{text('whatsapp', 'WhatsApp number', '0803 555 0142', 'For the calls to action.', 'tel')}</div>
          <label className="field">Competitors to learn from <span className="hint">Optional: up to 3 Instagram handles of businesses you compete with.</span>
            <input type="text" value={d.competitors} onChange={(e) => set('competitors', e.target.value)} placeholder="@chopsbyada @lagosbites" />
          </label>
        </div>
      )}

      {cur === 'offer' && (
        <div className="form">
          <label className="field">Menu or prices <span className="hint">One per line, like “Party tray (20 guests) – ₦25,000”. A line ending with “:” starts a group. Only what you write here, your posts and your listing will ever show as a price.</span>
            <textarea value={d.menu} onChange={(e) => set('menu', e.target.value)} placeholder={'Trays:\nParty tray (20 guests) – ₦25,000\nParty tray (50 guests) – ₦58,000\nBy the piece:\nPuff-puff (50 pieces) – ₦6,000'} />
          </label>
          <label className="field">Your story <span className="hint">Optional. A few lines in your own words: how you started, what you’re known for.</span>
            <textarea style={{ minHeight: 90 }} value={d.story} onChange={(e) => set('story', e.target.value)} />
          </label>
          {photosField('Up to 10. Your real food, work, shop or team; we never use flyers as photos. If you skip this, we use your Instagram.')}
          {logoField('Optional. It goes in the header and sets the colours.')}
        </div>
      )}

      {cur === 'look' && (
        <div className="form">
          <div className="field">Style
            <div className="themes">
              <button type="button" className={`theme auto${d.style === 'auto' ? ' on' : ''}`} onClick={() => set('style', 'auto')}><b>Choose for me</b><span>The designer picks what fits your business</span></button>
              {THEMES.map((t) => (
                <button type="button" key={t.id} className={`theme${d.style === t.id ? ' on' : ''}`} onClick={() => set('style', t.id)} style={{ background: t.bg, color: t.ink }}>
                  <i style={{ fontFamily: t.font, fontStyle: t.italic ? 'italic' : 'normal', textTransform: t.caps ? 'uppercase' : 'none', fontStretch: t.caps ? '125%' : undefined }}>Aa</i>
                  <b>{t.name}</b><span>{t.mood}</span>
                </button>
              ))}
            </div>
          </div>
          {colourField()}
          <div className="field">Sections <span className="hint">We only add a section when we have real content for it.</span>
            <div className="checks">{SECTIONS.map(([k, l]) => <label key={k} className={`chip click${d.sections.includes(k) ? ' on' : ''}`}><input type="checkbox" hidden checked={d.sections.includes(k)} onChange={(e) => set('sections', e.target.checked ? [...d.sections, k] : d.sections.filter((x) => x !== k))} />{l}</label>)}</div>
          </div>
          {notes('Optional: colours to avoid, words to use, what to highlight.')}
        </div>
      )}

      {cur === 'content' && (
        <div className="form">
          <div className="field">Where you post {chips('platforms', PLATFORMS)}</div>
          <div className="field">What it should do for you {pick('goal', GOALS.map((g) => [g, g]))}
            <input type="text" value={d.goal} onChange={(e) => set('goal', e.target.value)} placeholder="Or write your own goal" />
          </div>
          <div className="field">Your voice {pick('tone', TONES.map((t) => [t, t]))}</div>
          {photosField('Optional, up to 3. We restage your real products for the post images instead of inventing them.', 3)}
          {colourField('No preference')}
          {notes('Optional: an offer to push this week, words you always use, topics to avoid.')}
        </div>
      )}

      {cur === 'ad' && (
        <div className="form">
          {text('promote', 'What is the ad for?', 'Weekend suya platter for 4', 'One product, offer or service.')}
          {text('price', 'Price to show', '₦12,000', 'Optional. Shown exactly as you write it.')}
          <div className="field">What should people do? {pick('cta', CTAS)}</div>
          {(d.cta === 'whatsapp' || d.cta === 'call') && text('whatsapp', d.cta === 'call' ? 'Phone number' : 'WhatsApp number', '0812 345 6789', undefined, 'tel')}
          {d.cta === 'dm' && text('instagram', 'Instagram', '@yourbusiness')}
          {d.cta === 'website' && text('website', 'Website', 'yourbusiness.com')}
          {d.cta === 'visit' && text('address', 'Address', '5 Admiralty Way, Lekki Phase 1')}
          {service === 'motion-ad' && <div className="field">Format {pick('format', [['vertical', 'Vertical · Reels, TikTok, Status'], ['square', 'Square · feed'], ['landscape', 'Landscape · X, YouTube, website']])}</div>}
          {service === 'motion-ad' && <div className="field">Length <div className="checks">{[12, 16, 20, 24].map((n) => <button type="button" key={n} className={`chip click${d.length === n ? ' on' : ''}`} onClick={() => set('length', n)}>{n} s</button>)}</div></div>}
          {photosField(service === 'ad-launch' ? 'Your product photo: we stage the real thing for each ad and the video. Add 1–3; the first is used.' : 'Optional, up to 3. They appear inside the motion design.', 3)}
          {logoField(service === 'ad-launch' ? 'Optional. It goes on every ad and the end card.' : 'Optional. It closes the ad.')}
          {colourField('Choose for me')}
          {service !== 'ad-launch' && notes('Optional: the mood, words to use, anything to avoid.')}
        </div>
      )}

      {cur === 'plan' && (
        <div className="form">
          <div className="field">What should the ads bring you? {pick('adGoal', AD_GOALS)}</div>
          {text('adBudget', 'How much you can spend', '₦5,000 a day', 'A daily, weekly or total amount. We plan a 7-day test around it.')}
          <div className="field">Where to run them {chips('adPlatforms', AD_PLATFORMS)}</div>
          {text('audience', 'Who buys from you', 'Women 25–45 in Lekki and Ajah who host parties', 'Optional. If you leave it out, we keep the audience broad and let Meta find buyers.')}
          <div className="field">Already boosting or running ads? <span className="hint">Optional: screenshots of the results screen. We read the numbers and tell you what to change.</span>
            <div className="uploads">
              {d.adResults.map((id) => <figure key={id}><img src={`/api/uploads/${id}`} alt="" /><button type="button" aria-label="Remove" onClick={() => set('adResults', d.adResults.filter((x) => x !== id))}>×</button></figure>)}
              {d.adResults.length < 4 && <label className="addph">{up === 'adResults' ? 'Uploading…' : '+ Add screenshots'}<input type="file" accept="image/*" multiple onChange={(e) => addPhotos(e.target.files, 'adResults')} hidden /></label>}
            </div>
          </div>
          {notes('Optional: an offer to push, words to use, anything to avoid.')}
        </div>
      )}

      {cur === 'shots' && (
        <div className="form">
          {photosField('Up to 3 clear photos of the product, on any background, in good light. Each one becomes several shots.', 3)}
          {text('product', 'What is in the photos?', 'Shea butter body cream, 250 ml jar', 'So the team knows exactly what must not change.')}
          <div className="field">Where you'll use them {chips('uses', USES)}</div>
          <div className="field">The look {pick('look', LOOKS)}</div>
          {colourField('No preference')}
          {notes('Optional: a setting you like, props to use, anything to avoid.')}
        </div>
      )}

      {cur === 'buy' && (
        <div className="form">
          <label className="field">What you need <span className="hint">One per line, with how many. Add the model if you know it.</span>
            <textarea style={{ minHeight: 100 }} value={d.items} onChange={(e) => set('items', e.target.value)} placeholder={'2 chest freezers, about 300 litres\n1 commercial deep fryer, gas'} />
          </label>
          <div className="field">Condition {pick('condition', [['new', 'New'], ['used', 'Used is fine'], ['any', 'Either']])}</div>
          <div className="two-up">{text('budget', 'Budget', '₦900,000', 'Optional.')}{text('deliverTo', 'Deliver to', 'Surulere, Lagos')}</div>
          <label className="field">Sellers you're already talking to <span className="hint">Optional, one per line: name, Instagram, phone or link. We check them before you pay.</span>
            <textarea style={{ minHeight: 80 }} value={d.sellers} onChange={(e) => set('sellers', e.target.value)} placeholder={'Cool Tech NG, @cooltechng, 0803 111 2222'} />
          </label>
          {notes('Optional: brands you trust or avoid, how soon you need it.')}
        </div>
      )}

      {cur === 'audit' && (
        <div className="form">
          <div className="two-up">{text('website', 'Website', 'yourbusiness.com', 'We read it for your real hours and prices.')}{text('instagram', 'Instagram', '@yourbusiness')}</div>
          {text('maps', 'Google Maps link', 'https://maps.app.goo.gl/…', 'Helps us find the right listing.', 'url')}
          {text('searches', 'What customers type to find a business like yours', 'small chops Surulere, party catering Lagos', 'Optional. We check where you show up on Google Maps for these, street by street.')}
          {text('competitors', 'Businesses you compete with', 'Amala Shitta, The Place Yaba', 'Optional, up to 3, separated by commas. We compare you with them.')}
          <label className="field">Your prices <span className="hint">Optional, one per line. We check what Google and the AI assistants say about your prices against these.</span>
            <textarea style={{ minHeight: 100 }} value={d.menu} onChange={(e) => set('menu', e.target.value)} placeholder={'Jollof rice & chicken – ₦3,500\nPounded yam & egusi – ₦4,000'} />
          </label>
          <label className="field">What do you want to know about your market? <span className="hint">Optional. E.g. “what do other caterers in Surulere charge for a party tray?” or “is there demand for delivery in Ikeja?” The team researches it, with sources.</span>
            <textarea style={{ minHeight: 70 }} value={d.research} onChange={(e) => set('research', e.target.value)} placeholder="What do the top salons in Wuse charge for braids?" />
          </label>
          <label className="field">A question your customers ask <span className="hint">Optional. We ask ChatGPT, Gemini, Claude and Perplexity too.</span>
            <textarea style={{ minHeight: 80 }} value={d.questions} onChange={(e) => set('questions', e.target.value)} placeholder="Do you deliver to Victoria Island?" />
          </label>
        </div>
      )}

      {cur === 'flyer' && (
        <div className="form">
          <div className="field">What kind {pick('flyerKind', FLYER_KINDS)}</div>
          {d.flyerKind === 'pricelist' ? (
            <label className="field">Items and prices <span className="hint">One per line, like “Party tray (20 guests) – ₦25,000”. A line ending with “:” starts a group. Shown exactly as you write them.</span>
              <textarea value={d.menu} onChange={(e) => set('menu', e.target.value)} placeholder={'Trays:\nParty tray (20 guests) – ₦25,000\nParty tray (50 guests) – ₦58,000\nBy the piece:\nPuff-puff (50 pieces) – ₦6,000'} />
            </label>
          ) : (
            <>
              {text('promote', d.flyerKind === 'announcement' ? 'What are you announcing?' : 'What is the flyer for?', d.flyerKind === 'announcement' ? 'We’ve moved to 14 Adelabu Street from 1 November' : 'Weekend party trays, delivered across Lagos', d.flyerKind === 'announcement' ? 'Include any date or time; it’s shown exactly.' : 'One product, offer or service.')}
              {d.flyerKind === 'promo' && text('price', 'Price or deal to show', 'From ₦25,000', 'Optional. Shown exactly as you write it.')}
            </>
          )}
          <div className="field">How should people respond? {pick('cta', CTAS)}</div>
          <div className="two-up">{text('whatsapp', 'WhatsApp number', '0803 555 0142', undefined, 'tel')}{text('instagram', 'Instagram', '@yourbusiness')}</div>
          <div className="two-up">{text('address', 'Address', '14 Adelabu Street, Surulere', 'Optional, shown at the bottom.')}{text('website', 'Website', 'yourbusiness.com', 'Optional.')}</div>
          {photosField('Optional, up to 3: your product, food or shop. Product photos on a plain background look best.', 3)}
          {logoField('Optional. It goes at the top.')}
          {colourField('Choose for me')}
          {notes('Optional: words to use, things to leave out, a date it ends.')}
        </div>
      )}

      {cur === 'statement' && (
        <div className="form">
          <div className="note">Your statement is private. It's stored apart from everything else, read only to make your report, and deleted when the report is done. The report opens only from the private link we email you.</div>
          <div className="field">Bank statement <span className="hint">The PDF from your bank or app (GTBank, Access, Opay, Moniepoint, Kuda…), a CSV export, or clear screenshots of every page. One to three months works best.</span>
            <div className="uploads">
              {stmts.map((x) => <figure key={x.id} className="docfile"><span>{x.kind === 'image' ? '🖼' : '📄'} {x.name}{x.pages ? ` · ${x.pages} page${x.pages === 1 ? '' : 's'}` : ''}</span><button type="button" aria-label="Remove" onClick={() => { const all = stmts.filter((y) => y.id !== x.id); setStmts(all); set('statements', all.map((y) => y.id)); }}>×</button></figure>)}
              {stmts.length < 6 && <label className="addph">{up === 'statements' ? 'Reading it…' : '+ Add statement'}<input type="file" accept="application/pdf,.pdf,.csv,text/csv,text/plain,image/*" multiple onChange={(e) => addStatements(e.target.files)} hidden /></label>}
            </div>
          </div>
          {text('_pw', 'Statement password', 'Only if your bank locked the PDF', 'Used once to open the file on our server, never stored. Add it before uploading.', 'password')}
          {notes('Optional: what you want to know, e.g. “why am I always short at month end?”')}
        </div>
      )}

      {last && (
        <label className="field">Your email <span className="hint">{emailHint[service] ?? 'We send the work here.'} It’s also your key to accept, revise or reject.</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" />
        </label>
      )}

      {err && <div className="error">{err}</div>}
      <div className="bnav">
        {step > 0 && <button type="button" className="btn ghost" onClick={() => setStep(step - 1)}>Back</button>}
        {!last
          ? <button type="button" className="btn primary" disabled={!valid[cur]} onClick={() => setStep(step + 1)}>Next: {flow[step + 1].title}</button>
          : <button type="button" className="btn primary" disabled={busy || !allValid || !!up} onClick={() => onSubmit(d)}>{busy ? 'The CFO is pricing it…' : cta}</button>}
      </div>
      {!valid[cur] && why[cur] && <p className="muted" style={{ fontSize: 13 }}>{why[cur]}</p>}
    </div>
  );
}
