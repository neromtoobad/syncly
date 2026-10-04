'use client';
// The owner's site editor, opened from the private link in their delivery email. They change facts (prices,
// hours, the menu, where they sell and get paid) and a few safe parts of the look; the site engine re-renders
// the page for the preview, and Publish puts it live. Every publish keeps the previous version for Undo.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib.tsx';
import { upload } from '@/views/BusinessForm.tsx';

type Item = { id?: string; name: string; price?: string; note?: string; category?: string };
type Bank = { bank: string; accountName: string; accountNumber: string; note?: string };
type Facts = {
  name: string; offer: string; phone?: string; whatsapp?: string; email?: string; address?: string; area?: string; city?: string; landmark?: string;
  hoursText?: string; delivery?: string; instagram?: string; tiktok?: string; facebook?: string; items: Item[]; links: Record<string, string>; bank: Bank | null; kind: string;
};
type Look = { theme: string; brand: string; headline: string; sub: string; eyebrow?: string; heroPhoto?: string; gallery: string[]; whatsappText: string; sections: string[]; hidden: string[] };
type View = {
  slug: string; url: string; updatedAt: string; canUndo: boolean; facts: Facts; plan: Look;
  photos: { id: string; file: string; subject: string }[]; themes: { id: string; mood: string }[];
  integrations: { id: string; label: string; group: string; hint: string }[];
};
type Tab = 'sell' | 'menu' | 'details' | 'photos' | 'look';

const TABS: [Tab, string][] = [['sell', 'Orders & payments'], ['menu', 'Menu & prices'], ['details', 'Details & hours'], ['photos', 'Photos'], ['look', 'Look']];
const GROUPS: [string, string, string][] = [
  ['order', 'Order online', 'Food delivery apps. Your page gets an “Order on Chowdeck” button next to WhatsApp.'],
  ['shop', 'Shop & take payments', 'Payment pages and online stores. Shown as “Pay online” or “Shop online”.'],
  ['book', 'Bookings', 'Customers pick a time themselves.'],
  ['tickets', 'Tickets', 'For events: shown as “Get tickets”.'],
  ['review', 'Google reviews', 'Your “write a review” link. Shown under your reviews.'],
  ['social', 'More places to follow you', 'Shown in the footer.'],
];
const THEME_NAME: Record<string, string> = { atelier: 'Editorial', street: 'Bold', salon: 'Elegant', studio: 'Minimal', clinic: 'Calm', market: 'Playful', lounge: 'Dark luxe' };
const SECTION_NAME: Record<string, string> = { strip: 'Quick facts strip', offer: 'Menu / prices', gallery: 'Photo gallery', reviews: 'Google reviews', about: 'About us', steps: 'How to order', location: 'Map & hours', faq: 'Questions', cta: 'Call to action' };
const SWATCHES = ['#C0392B', '#D4380D', '#E67E22', '#D4A017', '#2E7D32', '#0F766E', '#1D4ED8', '#6D28D9', '#BE185D', '#111827'];
const FACT_KEYS = ['name', 'offer', 'phone', 'whatsapp', 'email', 'address', 'area', 'city', 'landmark', 'hoursText', 'delivery', 'instagram', 'tiktok', 'facebook'] as const;
const LOOK_KEYS = ['theme', 'brand', 'headline', 'sub', 'eyebrow', 'heroPhoto', 'whatsappText'] as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const emptyBank: Bank = { bank: '', accountName: '', accountNumber: '', note: '' };

/** Only what changed goes to the server, so an untouched field is never rewritten. */
function diff(base: View, f: Facts, p: Look) {
  const facts: Record<string, unknown> = {}, plan: Record<string, unknown> = {};
  for (const k of FACT_KEYS) if ((f[k] ?? '') !== (base.facts[k] ?? '')) facts[k] = f[k] ?? '';
  if (!same(f.items, base.facts.items)) facts.items = f.items;
  if (!same(f.links, base.facts.links)) facts.links = f.links;
  if (!same(f.bank, base.facts.bank)) facts.bank = f.bank && (f.bank.accountNumber || f.bank.bank) ? f.bank : null;
  for (const k of LOOK_KEYS) if ((p[k] ?? '') !== (base.plan[k] ?? '')) plan[k] = p[k] ?? '';
  if (!same(p.gallery, base.plan.gallery)) plan.gallery = p.gallery;
  if (!same(p.hidden, base.plan.hidden)) plan.hidden = p.hidden;
  return { facts, plan, changed: Object.keys(facts).length + Object.keys(plan).length };
}

export default function SiteEditor({ token }: { token: string }) {
  const [base, setBase] = useState<View | null>(null);
  const [f, setF] = useState<Facts | null>(null);
  const [p, setP] = useState<Look | null>(null);
  const [tab, setTab] = useState<Tab>('sell');
  const [html, setHtml] = useState('');
  const [device, setDevice] = useState<'phone' | 'laptop'>('phone');
  const [showPreview, setShowPreview] = useState(false); // phones: the preview opens over the form
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [chow, setChow] = useState<{ url: string; name?: string; phone?: string; phoneMatches: boolean; items: Item[]; hoursText?: string } | null>(null);

  const load = useCallback((v: View) => { setBase(v); setF({ ...v.facts, bank: v.facts.bank ?? null }); setP({ ...v.plan }); }, []);
  useEffect(() => { api<View>(`/api/site-edit/${token}`).then(load).catch((e) => setErr(e.message)); }, [token, load]);

  const patch = useMemo(() => (base && f && p ? diff(base, f, p) : null), [base, f, p]);
  // The preview follows every change, a moment after typing stops.
  const seq = useRef(0);
  useEffect(() => {
    if (!patch) return;
    const n = ++seq.current;
    const t = setTimeout(() => {
      api<{ html: string; notes: string[] }>(`/api/site-edit/${token}/preview`, { method: 'POST', body: JSON.stringify({ facts: patch.facts, plan: patch.plan }) })
        .then((r) => { if (n === seq.current) { setHtml(r.html); setNotes(r.notes ?? []); } })
        .catch((e) => n === seq.current && setErr(e.message));
    }, html ? 450 : 0);
    return () => clearTimeout(t);
  }, [patch, token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err && !base) return <main className="sedit-msg"><div className="card pad"><h1>Can’t open this editor</h1><p className="muted">{err}</p><a className="btn secondary" href="/">Go to Syncly</a></div></main>;
  if (!base || !f || !p || !patch) return <main className="sedit-msg"><p className="muted">Opening your site…</p></main>;

  const setFact = <K extends keyof Facts>(k: K, v: Facts[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  const setLook = <K extends keyof Look>(k: K, v: Look[K]) => setP((x) => (x ? { ...x, [k]: v } : x));
  const setItem = (i: number, v: Partial<Item>) => setFact('items', f.items.map((x, j) => (j === i ? { ...x, ...v } : x)));
  const moveItem = (i: number, d: -1 | 1) => { const a = [...f.items]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setFact('items', a); };
  const setLink = (id: string, url: string) => { const l = { ...f.links }; if (url.trim()) l[id] = url.trim(); else delete l[id]; setFact('links', l); };
  const bank = f.bank ?? emptyBank;
  const setBank = (v: Partial<Bank>) => setFact('bank', { ...bank, ...v });

  async function act<T>(label: string, fn: () => Promise<T>) {
    setBusy(label); setErr(null); setDone(null);
    try { return await fn(); } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  }
  const publish = () => act('publish', async () => {
    const v = await api<View>(`/api/site-edit/${token}/publish`, { method: 'POST', body: JSON.stringify({ facts: patch.facts, plan: patch.plan }) });
    load({ ...v, integrations: base.integrations }); setDone('Published. Your site is live with these changes.');
  });
  const undo = () => act('undo', async () => {
    if (!confirm('Put back the version before your last publish?')) return;
    const v = await api<View>(`/api/site-edit/${token}/undo`, { method: 'POST' });
    load({ ...v, integrations: base.integrations }); setDone('The previous version is live again.');
  });
  const discard = () => load(base);
  const readChowdeck = () => act('chowdeck', async () => {
    const r = await api<NonNullable<typeof chow>>(`/api/site-edit/${token}/chowdeck`, { method: 'POST', body: JSON.stringify({ url: f.links.chowdeck ?? '' }) });
    setChow(r);
  });
  const importChowdeck = (mode: 'add' | 'replace') => {
    if (!chow) return;
    const have = new Set(f.items.map((i) => i.name.trim().toLowerCase()));
    const fresh = chow.items.filter((i) => !have.has(i.name.trim().toLowerCase())).map(({ name, price, note, category }) => ({ name, price, note, category }));
    setF((x) => x && ({ ...x, items: mode === 'replace' ? chow.items.map(({ name, price, note, category }) => ({ name, price, note, category })) : [...x.items, ...fresh], hoursText: x.hoursText || chow.hoursText }));
    setChow(null); setTab('menu');
  };
  const addPhotos = (list: FileList | null) => act('photo', async () => {
    if (!list?.length) return;
    const ids = await upload([...list].filter((x) => x.type.startsWith('image/')).slice(0, 6));
    const added: View['photos'] = [];
    for (const id of ids) added.push(await api(`/api/site-edit/${token}/photo`, { method: 'POST', body: JSON.stringify({ upload: id }) }));
    setBase((b) => b && { ...b, photos: [...b.photos, ...added] });
    setP((x) => x && { ...x, gallery: [...x.gallery, ...added.map((a) => a.id)].slice(0, 8) });
  });

  const field = (label: string, value: string | undefined, on: (v: string) => void, o: { ph?: string; hint?: string; type?: string; area?: boolean } = {}) => (
    <label className="field">{label}{o.hint && <span className="hint">{o.hint}</span>}
      {o.area ? <textarea value={value ?? ''} placeholder={o.ph} onChange={(e) => on(e.target.value)} style={{ minHeight: 76 }} /> : <input type={o.type ?? 'text'} value={value ?? ''} placeholder={o.ph} onChange={(e) => on(e.target.value)} />}
    </label>
  );
  const live = base.url.replace(/^https?:\/\/[^/]+/, '');
  const ints = base.integrations.filter((i) => !(i.group === 'social' && ['instagram', 'tiktok', 'facebook'].includes(i.id)));

  return (
    <main className="sedit">
      <header className="sedit__top">
        <div className="sedit__who">
          <span className="mono">Your site</span>
          <b>{base.facts.name}</b>
          <a href={live} target="_blank" rel="noopener">{base.url.replace(/^https?:\/\//, '')} ↗</a>
        </div>
        <div className="sedit__acts">
          <span className={`sedit__state${patch.changed ? ' dirty' : ''}`}>{patch.changed ? `${patch.changed} unpublished change${patch.changed === 1 ? '' : 's'}` : 'Everything is live'}</span>
          {patch.changed > 0 && <button className="btn ghost sm" onClick={discard} disabled={!!busy}>Discard</button>}
          {base.canUndo && !patch.changed && <button className="btn secondary sm" onClick={undo} disabled={!!busy}>{busy === 'undo' ? 'Undoing…' : 'Undo last publish'}</button>}
          <button className="btn primary sm" onClick={publish} disabled={!patch.changed || !!busy}>{busy === 'publish' ? 'Publishing…' : 'Publish'}</button>
        </div>
      </header>
      {(err || done) && <div className={err ? 'error sedit__note' : 'sedit__note ok'}>{err ?? done}</div>}

      <div className="sedit__body">
        <section className="sedit__form">
          <nav className="sedit__tabs" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>

          {tab === 'sell' && (
            <div className="form">
              <p className="muted sedit__lead">Paste the links you already use. Each one becomes a button on your site, and only a link from that app fits its box.</p>
              {GROUPS.map(([g, title, hint]) => {
                const list = ints.filter((i) => i.group === g);
                return (
                  <fieldset key={g} className="sedit__group">
                    <legend>{title}</legend><p className="hint">{hint}</p>
                    {list.map((i) => (
                      <div key={i.id} className="sedit__link">
                        <label className="field">{i.label}<input type="url" inputMode="url" value={f.links[i.id] ?? ''} placeholder={i.hint} onChange={(e) => setLink(i.id, e.target.value)} /></label>
                        {i.id === 'chowdeck' && f.links.chowdeck && <button type="button" className="btn secondary sm" onClick={readChowdeck} disabled={!!busy}>{busy === 'chowdeck' ? 'Reading your store…' : 'Bring in my Chowdeck menu'}</button>}
                      </div>
                    ))}
                    {g === 'order' && chow && (
                      <div className="sedit__chow">
                        <b>{chow.name ?? 'Your store'}: {chow.items.length} item{chow.items.length === 1 ? '' : 's'}{chow.hoursText ? ' and opening hours' : ''}</b>
                        {!chow.phoneMatches && <p className="warn">This store’s phone ({chow.phone}) isn’t the one on your site. Only import it if it’s yours.</p>}
                        {chow.items.length ? <div className="row"><button className="btn primary sm" onClick={() => importChowdeck('add')}>Add new items to my menu</button><button className="btn secondary sm" onClick={() => importChowdeck('replace')}>Replace my menu</button><button className="btn ghost sm" onClick={() => setChow(null)}>Cancel</button></div> : <p className="muted">There’s no menu on this store yet.</p>}
                      </div>
                    )}
                  </fieldset>
                );
              })}
              <fieldset className="sedit__group">
                <legend>Pay by bank transfer</legend><p className="hint">Shown as a card with a copy button, and a WhatsApp link to send proof of payment. Leave the account number empty to hide it.</p>
                <div className="two-up">{field('Bank', bank.bank, (v) => setBank({ bank: v }), { ph: 'Moniepoint, OPay, GTBank…' })}{field('Account number', bank.accountNumber, (v) => setBank({ accountNumber: v.replace(/[^\d ]/g, '') }), { ph: '10 digits', type: 'text' })}</div>
                {field('Account name', bank.accountName, (v) => setBank({ accountName: v }), { ph: 'As it shows on the transfer' })}
                {field('Note (optional)', bank.note, (v) => setBank({ note: v }), { ph: 'Send your receipt on WhatsApp and we confirm in minutes' })}
                {bank.accountNumber && bank.accountNumber.replace(/\D/g, '').length !== 10 && <p className="warn">Nigerian account numbers have 10 digits.</p>}
              </fieldset>
            </div>
          )}

          {tab === 'menu' && (
            <div className="form">
              <p className="muted sedit__lead">Change a price and it’s right everywhere on the site: the menu, Google’s view of it, and what AI assistants read.</p>
              <div className="sedit__items">
                {f.items.map((it, i) => (
                  <div key={it.id ?? `n${i}`} className="sedit__item">
                    <input type="text" aria-label="Item" value={it.name} placeholder="Item or service" onChange={(e) => setItem(i, { name: e.target.value })} />
                    <input type="text" aria-label="Price" value={it.price ?? ''} placeholder="₦0" onChange={(e) => setItem(i, { price: e.target.value })} />
                    <input type="text" aria-label="Group" value={it.category ?? ''} placeholder="Group" onChange={(e) => setItem(i, { category: e.target.value })} />
                    <input type="text" aria-label="Description" className="wide" value={it.note ?? ''} placeholder="Short description (optional)" onChange={(e) => setItem(i, { note: e.target.value })} />
                    <div className="tools">
                      <button type="button" aria-label="Move up" onClick={() => moveItem(i, -1)} disabled={i === 0}>↑</button>
                      <button type="button" aria-label="Move down" onClick={() => moveItem(i, 1)} disabled={i === f.items.length - 1}>↓</button>
                      <button type="button" aria-label="Remove" onClick={() => setFact('items', f.items.filter((_, j) => j !== i))}>×</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="row"><button type="button" className="btn secondary sm" onClick={() => setFact('items', [...f.items, { name: '', price: '' }])}>+ Add an item</button>{f.links.chowdeck && <button type="button" className="btn ghost sm" onClick={() => { setTab('sell'); readChowdeck(); }}>Bring in my Chowdeck menu</button>}</div>
            </div>
          )}

          {tab === 'details' && (
            <div className="form">
              {field('Business name', f.name, (v) => setFact('name', v))}
              {field('What you sell, in one line', f.offer, (v) => setFact('offer', v))}
              <div className="two-up">{field('WhatsApp', f.whatsapp, (v) => setFact('whatsapp', v), { type: 'tel' })}{field('Phone', f.phone, (v) => setFact('phone', v), { type: 'tel' })}</div>
              {field('Opening hours', f.hoursText, (v) => setFact('hoursText', v), { ph: 'Mon-Sat 8am-8pm; Sunday 12pm-6pm', hint: 'Written like “Mon-Fri 9am-6pm; Sat 10am-4pm”. Your site shows “Open now” from these.' })}
              {field('Address', f.address, (v) => setFact('address', v))}
              <div className="two-up">{field('Area', f.area, (v) => setFact('area', v))}{field('City', f.city, (v) => setFact('city', v))}</div>
              {field('Landmark', f.landmark, (v) => setFact('landmark', v), { ph: 'Opposite the National Stadium gate' })}
              {field('Delivery', f.delivery, (v) => setFact('delivery', v), { ph: 'We deliver across Lagos Mainland and Island', area: true })}
              <div className="two-up">{field('Instagram', f.instagram, (v) => setFact('instagram', v), { ph: '@yourbusiness' })}{field('TikTok', f.tiktok, (v) => setFact('tiktok', v), { ph: '@yourbusiness' })}</div>
              <div className="two-up">{field('Facebook page', f.facebook, (v) => setFact('facebook', v))}{field('Email', f.email, (v) => setFact('email', v), { type: 'email' })}</div>
            </div>
          )}

          {tab === 'photos' && (
            <div className="form">
              <p className="muted sedit__lead">Tap a photo to put it in your gallery. Pick one as the big photo at the top.</p>
              <div className="sedit__photos">
                {base.photos.map((ph) => {
                  const inG = p.gallery.includes(ph.id), hero = p.heroPhoto === ph.id;
                  return (
                    <figure key={ph.id} className={`${inG ? 'in' : ''}${hero ? ' hero' : ''}`}>
                      <button type="button" className="pick" onClick={() => setLook('gallery', inG ? p.gallery.filter((x) => x !== ph.id) : [...p.gallery, ph.id].slice(0, 8))} aria-pressed={inG} aria-label={`${inG ? 'Remove from' : 'Add to'} gallery: ${ph.subject}`}><img src={`${live}/${ph.file}`} alt="" loading="lazy" /></button>
                      <figcaption><button type="button" className={hero ? 'on' : ''} onClick={() => setLook('heroPhoto', hero ? '' : ph.id)}>{hero ? 'Top photo ✓' : 'Use at top'}</button>{inG && <span className="n">{p.gallery.indexOf(ph.id) + 1}</span>}</figcaption>
                    </figure>
                  );
                })}
                <label className="addph">{busy === 'photo' ? 'Uploading…' : '+ Add photos'}<input type="file" accept="image/*" multiple hidden onChange={(e) => addPhotos(e.target.files)} /></label>
              </div>
              <p className="hint">The gallery shows up to 8 photos (at least 3). {p.gallery.length < 3 && p.gallery.length > 0 ? 'Pick at least 3 to show a gallery.' : ''}</p>
            </div>
          )}

          {tab === 'look' && (
            <div className="form">
              <div className="field">Style
                <div className="checks">{base.themes.map((t) => <button type="button" key={t.id} title={t.mood} className={`chip click${p.theme === t.id ? ' on' : ''}`} onClick={() => setLook('theme', t.id)}>{THEME_NAME[t.id] ?? t.id}</button>)}</div>
              </div>
              <div className="field">Colour
                <div className="swatches">
                  {SWATCHES.map((c) => <button type="button" key={c} className={`sw${p.brand.toLowerCase() === c.toLowerCase() ? ' on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => setLook('brand', c)} />)}
                  <label className="sw pick" title="Your exact brand colour"><input type="color" value={p.brand} onChange={(e) => setLook('brand', e.target.value)} />Pick</label>
                </div>
              </div>
              {field('Headline', p.headline, (v) => setLook('headline', v), { hint: 'The big line at the top. Short works best on phones.' })}
              {field('Under the headline', p.sub, (v) => setLook('sub', v), { area: true })}
              {field('Small line above the headline (optional)', p.eyebrow, (v) => setLook('eyebrow', v))}
              {field('WhatsApp message customers start with', p.whatsappText, (v) => setLook('whatsappText', v))}
              <div className="field">Sections <span className="hint">Turn a section off to hide it. Nothing is deleted.</span>
                <div className="checks">{p.sections.filter((k) => k !== 'cta').map((k) => { const on = !p.hidden.includes(k); return <button type="button" key={k} className={`chip click${on ? ' on' : ''}`} onClick={() => setLook('hidden', on ? [...p.hidden, k] : p.hidden.filter((x) => x !== k))}>{SECTION_NAME[k] ?? k}</button>; })}</div>
              </div>
              {notes.length > 0 && <p className="hint">Adjusted to fit: {notes.join('; ')}.</p>}
            </div>
          )}
        </section>

        <section className={`sedit__preview${showPreview ? ' open' : ''}`} aria-label="Preview">
          <div className="sedit__pbar">
            <div className="checks">{(['phone', 'laptop'] as const).map((d) => <button key={d} type="button" className={`chip click${device === d ? ' on' : ''}`} onClick={() => setDevice(d)}>{d === 'phone' ? 'Phone' : 'Laptop'}</button>)}</div>
            <span className="mono muted">{patch.changed ? 'Preview: not live yet' : 'Live version'}</span>
            <button type="button" className="btn ghost sm sedit__close" onClick={() => setShowPreview(false)}>Close</button>
          </div>
          <div className={`sedit__frame ${device}`}>{html ? <iframe title="Site preview" srcDoc={html} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" /> : <p className="muted">Rendering…</p>}</div>
        </section>
      </div>
      <button type="button" className="btn primary sedit__peek" onClick={() => setShowPreview(true)}>Preview</button>
    </main>
  );
}
