import React from 'react';
import { Icon, KakisCard, PageTitle, TELEGRAM_BOT_URL as TELEGRAM_URL } from '../components/ui.jsx';

function Row({ to, icon, title, hint, tone }) {
  return (
    <a href={`#${to}`} className={`flex items-center gap-4 rounded-xl border-2 bg-white p-5 min-h-tap hover:bg-sky-50 ${tone === 'urgent' ? 'border-scam' : 'border-slate-300'}`}>
      <span className={`grid place-items-center w-12 h-12 rounded-full ${tone === 'urgent' ? 'bg-red-100 text-scam' : 'bg-sky-100 text-brand'}`}><Icon name={icon} className="w-7 h-7" /></span>
      <span className="flex-1">
        <span className="block font-bold">{title}</span>
        <span className="block text-slate-700 text-[1.05rem] leading-snug">{hint}</span>
      </span>
      <Icon name="chevron" className="w-6 h-6 text-slate-500" />
    </a>
  );
}

export default function Home() {
  return (
    <div>
      <PageTitle sub="Paste it in and we will point out the warning signs. English, Singlish and mixed languages are all fine.">
        Got a message that does not feel right?
      </PageTitle>
      <a href="#/check" className="btn-primary w-full text-lg !min-h-[76px]"><Icon name="search" className="w-8 h-8" /> Check a message</a>
      <div className="mt-6 grid gap-4">
        <Row to="/help" icon="lifebuoy" tone="urgent" title="I have already been scammed" hint="Step-by-step help, starting with what to do first" />
        <KakisCard title="Ask other people (Kakis)" hint="On Telegram, other SafeKaki users chat with you and vote on whether it is a scam. They never see your name or number." />
        <Row to="/report" icon="flag" title="Report a scam" hint="We prepare the report. You check it and send it." />
        <Row to="/share" icon="lock" title="Warn family safely" hint="We hide names and numbers before you pass it on" />
        <Row to="/learn" icon="book" title="Learn about common scams" hint="How they work and how to spot them" />
      </div>
      <p className="mt-8 text-slate-700">
        Not sure about something? Call the free <a className="link" href="tel:1799">ScamShield Helpline 1799</a>, open 24 hours.
        {TELEGRAM_URL && <> You can also <a className="link" href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">use SafeKaki on Telegram</a>.</>}
      </p>
      <p className="mt-3 text-slate-600 text-[1.05rem]">What you paste is sent to our server and an AI service to be read. We do not save it. Please do not paste real passwords or OTPs.</p>
    </div>
  );
}
