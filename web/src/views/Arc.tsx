'use client';
// /arc: get USDC on Arc before paying for a job or an invoice.
import { useApi } from '@/lib.tsx';
import { BringMoneyPanel } from '@/components/BringMoney.tsx';
import type { EscrowCfg } from '@/wallet.ts';

export default function Arc() {
  const { data: esc } = useApi<EscrowCfg | { enabled: false }>('/api/escrow');
  const cfg = esc && esc.enabled ? esc : null;
  return (
    <main className="wrap" style={{ maxWidth: 640, margin: '0 auto', padding: '48px 20px 80px' }}>
      <div className="eyebrow">Paying on Syncly</div>
      <h1 style={{ fontSize: 'clamp(34px, 5vw, 52px)', letterSpacing: '-0.035em', lineHeight: 1.05, margin: '8px 0 12px' }}>Get USDC on Arc</h1>
      <p className="muted" style={{ fontSize: 17, lineHeight: 1.55, margin: '0 0 24px' }}>Every job and invoice on Syncly is paid in USDC on Arc. If your money is somewhere else, bring it here in under a minute: USDC from another chain over Circle’s CCTP, ETH or USDT swapped into USDC, or a withdrawal from your exchange.</p>
      <section className="card pad">{cfg ? <BringMoneyPanel cfg={cfg} /> : <p className="muted">Loading…</p>}</section>
    </main>
  );
}
