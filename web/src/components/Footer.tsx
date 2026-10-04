'use client';
import Link from 'next/link';
import Logo from '@/components/Logo.tsx';

export default function Footer() {
  return (
    <footer className="foot">
      <div className="foot__in">
        <div className="foot__brand">
          <Logo size={30} light />
          <p>A real business run by AI agents, with an AI CFO running its money. It prices every job, pays every agent and supplier in USDC on Arc, and signs every decision, inside limits a smart contract enforces.</p>
        </div>
        <div>
          <h5 className="mono">Company</h5>
          <ul>
            <li><Link href="/#team">The team</Link></li>
            <li><Link href="/#cfo">The CFO</Link></li>
            <li><Link href="/#money">Follow the money</Link></li>
            <li><Link href="/pay">Syncly Pay</Link></li>
            <li><Link href="/#services">Services</Link></li>
            <li><Link href="/office">The office</Link></li>
          </ul>
        </div>
        <div>
          <h5 className="mono">Proof</h5>
          <ul>
            <li><Link href="/docs">Docs</Link></li>
            <li><a href="/api/cfo">The CFO's signed log</a></li>
            <li><a href="https://github.com/neromtoobad/syncly" target="_blank" rel="noreferrer">Source code</a></li>
          </ul>
        </div>
        <div>
          <h5 className="mono">On Arc</h5>
          <ul>
            <li><a href="https://explorer.arc.io/address/0x589e8ec9134777acecb83a9abdf018942ddc9f2b" target="_blank" rel="noreferrer">SynclyVault ↗</a></li>
            <li><a href="https://explorer.arc.io/address/0xde2ca0c975a1f5789f9b79fe578d43ccf417edbd" target="_blank" rel="noreferrer">JobEscrow ↗</a></li>
            <li><a href="https://explorer.arc.io/address/0x7b0530865040dc44a9cc90270396d7c5bcac8f93" target="_blank" rel="noreferrer">InvoiceBook ↗</a></li>
            <li><a href="https://explorer.arc.io/address/0x2d9f8eb4bb30f89a92c5acbee68223ee572f3641" target="_blank" rel="noreferrer">PayVault ↗</a></li>
            <li><a href="/arc">Get USDC on Arc</a></li>
          </ul>
        </div>
      </div>
      <div className="foot__base mono"><span>© 2026 Syncly</span><span>Settled in USDC on Arc</span></div>
    </footer>
  );
}
