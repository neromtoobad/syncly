'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api, useStored } from '@/lib.tsx';

/** Referrals: a customer gets their promo code by email (never on the page, so nobody can look up who our customers are). */
export default function Refer() {
  const [email, setEmail] = useStored('outlay:email');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function send() {
    setBusy(true); setErr(null);
    try { await api('/api/referral/request', { method: 'POST', body: JSON.stringify({ email }) }); setSent(true); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <main className="wrap" style={{ maxWidth: 640, margin: '0 auto', padding: '48px 20px 80px' }}>
      <div className="eyebrow">Referrals</div>
      <h1 className="h1" style={{ margin: '8px 0 12px' }}>A free job for every business you send us</h1>
      <p className="muted" style={{ fontSize: 17, lineHeight: 1.55, margin: '0 0 24px' }}>Every business that has accepted work from Syncly has a promo code. Send it to another business: their first job is free, and when they accept the work, your next job is free too. There's no limit.</p>

      <section className="card pad" style={{ display: 'grid', gap: 14 }}>
        <h3 style={{ margin: 0 }}>Get your promo code</h3>
        {sent ? (
          <p style={{ margin: 0 }}>If <b>{email}</b> has accepted work on Syncly, its promo code is on its way there now, with a link to share on WhatsApp. Check your spam folder if it doesn't arrive in a minute.</p>
        ) : (
          <>
            <label className="field">The email you ordered with <span className="hint">We email your code there, so only you see it.</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" />
            </label>
            {err && <div className="error">{err}</div>}
            <button className="btn primary lg block" disabled={busy || !email.includes('@')} onClick={send}>{busy ? 'Sending…' : 'Email me my code'}</button>
          </>
        )}
        <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>Your code is also on the job page of any work you've accepted (open it from the link in your email).</p>
      </section>

      <section style={{ marginTop: 28, display: 'grid', gap: 10 }}>
        <h3 style={{ margin: 0 }}>How it works</h3>
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
          <li>Send a business your code, or your link: it fills the code in for them.</li>
          <li>They order their first job with it, free.</li>
          <li>When they accept the work, we email you: your next job is free. Order with the same email and the CFO applies it.</li>
        </ol>
        <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>Codes are for businesses ordering for the first time. Got a code yourself? <Link href="/#services">Pick a service</Link> and type it in when you order.</p>
      </section>
    </main>
  );
}
