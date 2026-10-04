'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApi } from '@/lib.tsx';
import Logo from '@/components/Logo.tsx';

const LINKS: [string, string][] = [['/#cfo', 'The CFO'], ['/#money', 'The money'], ['/pay', 'Pay'], ['/#team', 'The team'], ['/#services', 'Services'], ['/office', 'The office'], ['/docs', 'Docs']];

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
        {LINKS.map(([href, label], i) => <Link key={href} href={href} style={{ transitionDelay: `${menu ? 0.04 * i : 0}s` }}><span className="mono">0{i + 1}</span>{label}</Link>)}
        <Link href="/#services" className="pill dark" style={{ justifySelf: 'start', marginTop: 12 }}>Hire the team <span className="pill__ic">→</span></Link>
      </nav>
    </header>
  );
}
