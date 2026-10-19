import React from 'react';
import { Icon } from './ui.jsx';

const NAV = [
  { to: '/check', label: 'Check', icon: 'search' },
  { to: '/report', label: 'Report', icon: 'flag' },
  { to: '/share', label: 'Share', icon: 'lock' },
  { to: '/help', label: 'Get help', icon: 'lifebuoy' },
  { to: '/learn', label: 'Learn', icon: 'book' },
];

export default function Layout({ route, children }) {
  return (
    <div className="min-h-screen flex flex-col">
      <a href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }} className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-4 focus:m-2 focus:rounded-lg">Skip to main content</a>
      <header className="bg-brand text-white">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <a href="#/" className="flex items-center gap-3 font-bold text-lg min-h-tap" aria-label="SafeKaki home">
            <Icon name="shield" className="w-9 h-9" /> SafeKaki
          </a>
          <nav aria-label="Main" className="hidden md:flex gap-1">
            {NAV.map((n) => (
              <a key={n.to} href={`#${n.to}`} aria-current={route === n.to ? 'page' : undefined}
                className={`px-4 py-3 rounded-lg font-bold min-h-[48px] flex items-center ${route === n.to ? 'bg-white text-brand' : 'hover:bg-white/15'}`}>{n.label}</a>
            ))}
          </nav>
          <a href="tel:1799" className="md:hidden btn bg-white text-brand !min-h-[48px] !px-4 !py-2">
            <Icon name="phone" className="w-5 h-5" /> 1799
          </a>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="flex-1 w-full max-w-3xl mx-auto px-4 py-6 md:py-10 pb-28 md:pb-10 outline-none">{children}</main>
      <footer className="hidden md:block border-t border-slate-300 bg-white">
        <div className="max-w-3xl mx-auto px-4 py-5 text-slate-700">
          Not sure? Call the free <a className="link" href="tel:1799">ScamShield Helpline 1799</a>, open 24 hours. SafeKaki uses AI and can make mistakes.
        </div>
      </footer>
      <nav aria-label="Main" className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t-2 border-slate-300 grid grid-cols-5" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {NAV.map((n) => (
          <a key={n.to} href={`#${n.to}`} aria-current={route === n.to ? 'page' : undefined}
            className={`flex flex-col items-center justify-center gap-1 min-h-[68px] text-[0.95rem] font-bold ${route === n.to ? 'text-brand bg-sky-50 border-t-4 border-brand -mt-[2px]' : 'text-slate-700'}`}>
            <Icon name={n.icon} className="w-6 h-6" />{n.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
