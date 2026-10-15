'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApi } from '@/lib.tsx';
import Logo from '@/components/Logo.tsx';

// The bar: what a visitor needs first, in the order of the home page, then the story and the tools.
const LINKS: [string, string][] = [['/#services', 'Services'], ['/#how', 'How it works'], ['/#work', 'Real work'], ['/#cfo', 'The AI CFO'], ['/pay', 'Syncly Pay'], ['/docs', 'Docs']];
// The phone menu: everything, grouped by what you came for.
const GROUPS: { title: string; items: [string, string, string?][] }[] = [
  { title: 'Hire the team', items: [['/#services', 'Services', '10 jobs, $1 each'], ['/#how', 'How it works'], ['/#work', 'Real work'], ['/#pay', 'Pay in naira or USDC'], ['/#questions', 'Questions']] },
  { title: 'How Syncly runs', items: [['/#cfo', 'The AI CFO'], ['/#money', 'Follow the money'], ['/#team', 'The team'], ['/office', 'The office']] },
  { title: 'Tools', items: [['/pay', 'Syncly Pay', 'invoices and bills'], ['/arc', 'Get USDC on Arc'], ['/docs', 'Docs']] },
];

export default function Nav() {
  const { data } = useApi<{ mode: string }>('/api/health');
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  useEffect(() => setMenu(false), [path]);
  return (
    <header className={`nav${scrolled ? ' scrolled' : ''}${menu ? ' open' : ''}`}>
      <div className="nav__bar">
        <Link href="/" className="nav__logo" aria-label="Syncly home"><Logo size={28} /></Link>
        <nav className="nav__links">
          {LINKS.map(([href, label]) => <Link key={href} href={href} className={!href.includes('#') && path.startsWith(href) ? 'active' : ''}>{label}</Link>)}
        </nav>
        <span className="nav__sp" />
        {data && <span className={`nav__status ${data.mode}`}><span className="dot" />{data.mode === 'demo' ? 'Demo mode' : 'Live on Arc'}</span>}
        <Link href="/#services" className="pill dark nav__cta">Hire the team <span className="pill__ic">→</span></Link>
        <button className="pill dark nav__menu" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          Menu <span className="pill__ic">{menu ? '×' : '='}</span>
        </button>
      </div>
      <nav className="nav__sheet" aria-hidden={!menu}>
        {GROUPS.map((g, gi) => (
          <div key={g.title} className="nav__group">
            <span className="mono nav__gt">{g.title}</span>
            {g.items.map(([href, label, note], i) => <Link key={href} href={href} style={{ transitionDelay: `${menu ? 0.03 * (gi * 5 + i) : 0}s` }}>{label}{note && <small>{note}</small>}</Link>)}
          </div>
        ))}
        <Link href="/#services" className="pill dark" style={{ justifySelf: 'start', marginTop: 12 }}>Hire the team <span className="pill__ic">→</span></Link>
      </nav>
    </header>
  );
}
