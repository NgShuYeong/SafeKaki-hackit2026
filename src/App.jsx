import React, { useEffect, useState } from 'react';
import Layout from './components/Layout.jsx';
import Home from './screens/Home.jsx';
import Check from './screens/Check.jsx';
import Report from './screens/Report.jsx';
import Help from './screens/Help.jsx';
import Learn from './screens/Learn.jsx';
import Share from './screens/Share.jsx';

const ROUTES = { '/': Home, '/check': Check, '/report': Report, '/help': Help, '/learn': Learn, '/share': Share };
const current = () => { const h = (window.location.hash || '#/').slice(1) || '/'; return ROUTES[h] ? h : '/'; };

export default function App() {
  const [route, setRoute] = useState(current());
  // The checked message and its analysis are kept in memory only (never saved to disk or storage).
  const [session, setSession] = useState({ message: '', analysis: null, meta: null });
  useEffect(() => {
    const on = () => { setRoute(current()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const Screen = ROUTES[route];
  return <Layout route={route}><Screen key={route} session={session} setSession={setSession} /></Layout>;
}
