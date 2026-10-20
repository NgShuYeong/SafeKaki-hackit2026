// End-to-end UI test: real React app -> real SafeKaki API (rules-only mode, no LLM key) in a simulated browser.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let server, App;
beforeAll(async () => {
  process.env.LLM_API_KEY = ''; process.env.ANTHROPIC_API_KEY = ''; process.env.RATE_LIMIT_PER_MIN = '500';
  const { createApp } = await import('../../server/index.js');
  const { readImage } = await import('../../server/core/readImage.js');
  // Real image checks; the OCR engine itself is stubbed because it cannot run inside the simulated browser
  // (real OCR is covered in tests/image.test.js).
  const OCR_TEXT = "+65 8123 4567\nHi Ma, this is my new number. Can you help me transfer $1,200 to my friend's account first?\nOCBC 501-234567-001 name Lim Wei Jie. Don't call, I can't talk now.";
  const app = createApp({ readImage: (buf) => readImage(buf, { cfg: { apiKey: '' }, ocr: async () => ({ text: OCR_TEXT, confidence: 95 }) }) });
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  vi.stubEnv('VITE_API_BASE', `http://127.0.0.1:${server.address().port}`);
  vi.stubEnv('VITE_TELEGRAM_BOT_URL', 'https://t.me/SafeKakiTestBot');
  App = (await import('../../src/App.jsx')).default;
});
afterAll(() => server.close());
beforeEach(() => { cleanup(); window.location.hash = '#/'; });

const go = (hash) => { window.location.hash = hash; };
const renderAt = async (hash) => { go(hash); render(<App />); };
const OTP = "Hi, I'm from the bank. Need your OTP to verify your account.";

describe('Home', () => {
  it('shows the four main actions and the helpline', async () => {
    await renderAt('#/');
    expect(screen.getByRole('link', { name: /check a message/i })).toBeTruthy();
    expect(screen.getByText(/already been scammed/i)).toBeTruthy();
    expect(screen.getByText(/report a scam/i)).toBeTruthy();
    expect(screen.getByText(/learn about common scams/i)).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /1799/ }).length).toBeGreaterThan(0);
  });
});

describe('Check a message', () => {
  it('flags a scam, marks the original phrases, offers next steps', async () => {
    const user = userEvent.setup();
    await renderAt('#/check');
    await user.type(screen.getByLabelText(/the message/i), OTP);
    await user.click(screen.getByRole('button', { name: /check this message/i }));
    expect(await screen.findByText(/high risk: this message has strong signs/i)).toBeTruthy();
    const marks = document.querySelectorAll('mark.flag');
    expect(marks.length).toBeGreaterThan(0);
    expect([...marks].some((m) => /need your otp/i.test(m.textContent))).toBe(true);
    expect(screen.getByText(/what to do now/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /prepare a report/i })).toBeTruthy();
    // wording honesty: never says "definitely"
    expect(document.body.textContent).not.toMatch(/definitely a scam|100% a scam/i);
  });

  it('a harmless Singlish message is NOT called a scam, and is NOT called safe either', async () => {
    const user = userEvent.setup();
    await renderAt('#/check');
    await user.type(screen.getByLabelText(/the message/i), 'Eh bro dinner at 7 lah, I already book the table.');
    await user.click(screen.getByRole('button', { name: /check this message/i }));
    expect(await screen.findByText(/not enough evidence to judge/i)).toBeTruthy();
    expect(screen.getByText(/does not mean it is safe/i)).toBeTruthy();
    expect(screen.getByText(/not a safety check/i)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /prepare a report/i })).toBeNull();
    expect(document.querySelectorAll('mark.flag').length).toBe(0);
  });

  it('user who already shared a code sees the urgent block first', async () => {
    const user = userEvent.setup();
    await renderAt('#/check');
    await user.type(screen.getByLabelText(/the message/i), 'Eh I already gave the OTP and transferred $500 to the bank guy');
    await user.click(screen.getByRole('button', { name: /check this message/i }));
    const urgent = await screen.findByText(/act now: protect your money first/i);
    const verdict = screen.getByText(/be careful|high risk/i);
    expect(urgent.compareDocumentPosition(verdict) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('empty input shows a clear error and nothing is sent', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(globalThis, 'fetch');
    await renderAt('#/check');
    await user.click(screen.getByRole('button', { name: /check this message/i }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/please paste the message/i)).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('network failure shows a friendly error with a retry and the helpline', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    await renderAt('#/check');
    await user.type(screen.getByLabelText(/the message/i), OTP);
    await user.click(screen.getByRole('button', { name: /check this message/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/cannot be reached/i);
    expect(alert.textContent).toMatch(/1799/);
    expect(within(alert).getByRole('button', { name: /try again/i })).toBeTruthy();
    expect(alert.textContent).not.toMatch(/fetch failed|TypeError/);
    spy.mockRestore();
  });

  it('shows a loading state while waiting', async () => {
    const user = userEvent.setup();
    let release;
    const real = globalThis.fetch;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((...a) => new Promise((res) => { release = () => res(real(...a)); }));
    await renderAt('#/check');
    await user.type(screen.getByLabelText(/the message/i), OTP);
    await user.click(screen.getByRole('button', { name: /check this message/i }));
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByRole('button', { name: /check this message/i }).disabled).toBe(true);
    release(); spy.mockRestore();
    expect(await screen.findByText(/high risk: this message has strong signs/i)).toBeTruthy();
  });
});

describe('Report flow', () => {
  async function toReport(user) {
    await renderAt('#/check');
    await user.type(screen.getByLabelText(/the message/i), "Hi, I'm from the bank. Need your OTP now. Click dbs-sg-verify.top/login");
    await user.click(screen.getByRole('button', { name: /check this message/i }));
    await user.click(await screen.findByRole('link', { name: /prepare a report/i }));
  }

  it('prepares a draft that marks missing info, asks only needed questions, and is clearly not submitted', async () => {
    const user = userEvent.setup();
    await toReport(user);
    expect(await screen.findByText(/prepared, not submitted/i)).toBeTruthy();
    const preview = await screen.findByLabelText(/report preview/i);
    expect(preview.textContent).toMatch(/NOT PROVIDED/);
    expect(preview.textContent).toMatch(/Need your OTP now/); // original message preserved
    expect(screen.getByText(/did you transfer any money/i)).toBeTruthy();
    expect(screen.queryByText(/how much did you transfer/i)).toBeNull();
    expect(document.body.textContent).not.toMatch(/successfully submitted|report sent/i);
  });

  it('editing fields updates the preview; confirmation gates the official link; copy works', async () => {
    const user = userEvent.setup();
    await toReport(user);
    const desc = await screen.findByLabelText(/what happened/i);
    await user.clear(desc); await user.type(desc, 'Got this SMS at lunch');
    expect((await screen.findByLabelText(/report preview/i)).textContent).toMatch(/Got this SMS at lunch/);

    const gated = screen.getAllByRole('button', { name: /tick the box above/i });
    expect(gated.length).toBeGreaterThan(0); expect(gated[0].disabled).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: /i have checked this report/i }));
    const open = (await screen.findAllByRole('link', { name: /open official page/i }))[0];
    expect(open.getAttribute('href')).toMatch(/^https:\/\/(www\.scamshield\.gov\.sg|eservices1\.police\.gov\.sg)/);
    expect(open.getAttribute('rel')).toMatch(/noopener/);

    let copied = '';
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { copied = t; } }, configurable: true });
    await user.click(screen.getByRole('button', { name: /copy report/i }));
    expect(copied).toMatch(/Got this SMS at lunch/);
    expect(await screen.findByText(/still only a draft/i)).toBeTruthy();
  });

  it('answering "yes, I lost money" switches to urgent guidance and asks for the amount', async () => {
    const user = userEvent.setup();
    await toReport(user);
    const group = (await screen.findByText(/did you transfer any money/i)).closest('[role=group]');
    await user.click(within(group).getByRole('button', { name: 'Yes' }));
    expect(await screen.findByText(/protect your money first/i)).toBeTruthy();
    expect(await screen.findByLabelText(/how much did you transfer/i)).toBeTruthy();
  });

  it('starting from nothing shows an empty state that explains the options', async () => {
    await renderAt('#/report');
    expect(screen.getByText(/already checked a message/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /start my report/i }).disabled).toBe(true);
  });
});

describe('Help and Learn', () => {
  it('help: "I sent money" leads with calling the bank, then lists official contacts', async () => {
    const user = userEvent.setup();
    await renderAt('#/help');
    await user.click(screen.getByRole('button', { name: /i sent money/i }));
    const items = screen.getAllByRole('listitem');
    expect(items[0].textContent).toMatch(/call your bank now/i);
    expect(screen.getByRole('link', { name: /call 1799/i }).getAttribute('href')).toBe('tel:1799');
    expect(document.querySelector('a[href^="https://eservices1.police.gov.sg"]')).toBeTruthy();
  });
  it('learn: lists scam types with warning signs', async () => {
    await renderAt('#/learn');
    expect(screen.getByText(/fake bank messages/i)).toBeTruthy();
    expect(screen.getAllByText(/warning signs/i).length).toBeGreaterThan(3);
  });
});

describe('Accessibility basics', () => {
  it('has a skip link, labelled main nav, one h1 per screen, and focuses the heading', async () => {
    await renderAt('#/check');
    expect(screen.getByText(/skip to main content/i)).toBeTruthy();
    expect(screen.getAllByRole('navigation', { name: /main/i }).length).toBeGreaterThan(0);
    expect(document.querySelectorAll('h1').length).toBe(1);
    expect(document.activeElement.tagName).toBe('H1');
  });
});

describe('Server down (e.g. only "npm run dev" was started)', () => {
  it('explains that the checking server is not running instead of a vague error', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error('no body'); } });
    await renderAt('#/check');
    await user.type(screen.getByLabelText(/the message/i), OTP);
    await user.click(screen.getByRole('button', { name: /check this message/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/checking server is not running/i);
    expect(alert.textContent).toMatch(/npm run dev:all/);
    spy.mockRestore();
  });
});

describe('Warn family safely (merged from 12 Oct build)', () => {
  it('hides private details, keeps the link, and builds a family message', async () => {
    const user = userEvent.setup();
    await renderAt('#/share');
    await user.type(screen.getByLabelText(/^the message/i), 'Hi Mary Tan, call 9123 4567 and give OTP is 482910. https://dbs-x.top/a');
    await user.type(screen.getByLabelText(/other names to hide/i), 'Ah Seng');
    await user.click(screen.getByRole('button', { name: /hide private info/i }));
    expect(await screen.findByText(/hidden: .*phone number/i)).toBeTruthy();
    const family = screen.getByLabelText(/message for your family/i).textContent;
    expect(family).toMatch(/\[PHONE 1\]/);
    expect(family).toMatch(/https:\/\/dbs-x\.top\/a/);
    expect(family).not.toMatch(/9123 4567|482910|Mary Tan/);
    const wa = screen.getByRole('link', { name: /send on whatsapp/i }).getAttribute('href');
    expect(wa).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(decodeURIComponent(wa)).not.toMatch(/9123 4567/);
    await user.click(screen.getByRole('button', { name: /show me what was hidden/i }));
    expect([...document.querySelectorAll('li')].some((li) => /PHONE 1: 9123 4567/.test(li.textContent))).toBe(true);
  });

  it('a checked message carries over, and the family message names the risk', async () => {
    const user = userEvent.setup();
    await renderAt('#/check');
    await user.type(screen.getByLabelText(/the message/i), OTP + ' Call 9123 4567');
    await user.click(screen.getByRole('button', { name: /check this message/i }));
    await screen.findByText(/high risk: this message has strong signs/i);
    await user.click(screen.getByRole('link', { name: /warn family safely/i }));
    expect((await screen.findByLabelText(/^the message/i)).value).toMatch(/Need your OTP/);
    await user.click(screen.getByRole('button', { name: /hide private info/i }));
    const family = (await screen.findByLabelText(/message for your family/i)).textContent;
    expect(family).toMatch(/^Scam warning \(high risk\)/);
    expect(family).not.toMatch(/9123 4567/);
  });
});

describe('Voice input (merged from 12 Oct build)', () => {
  it('is hidden where the browser cannot listen, and fills the box where it can', async () => {
    await renderAt('#/check');
    expect(screen.queryByRole('button', { name: /speak instead/i })).toBeNull();
    cleanup();
    class FakeRec { start() { setTimeout(() => this.onresult({ resultIndex: 0, results: [[{ transcript: 'they ask for my OTP' }]] }), 0); } stop() { this.onend?.(); } }
    window.SpeechRecognition = FakeRec;
    try {
      const user = userEvent.setup();
      await renderAt('#/check');
      await user.click(screen.getByRole('button', { name: /speak instead/i }));
      await waitFor(() => expect(screen.getByLabelText(/the message/i).value).toBe('they ask for my OTP'));
    } finally { delete window.SpeechRecognition; }
  });
});

describe('Screenshots', () => {
  it('uploading a screenshot fills the message box, then it can be checked', async () => {
    const fs = await import('node:fs');
    const png = fs.readFileSync(`${process.cwd()}/tests/fixtures/scam-chat.png`);
    const user = userEvent.setup();
    await renderAt('#/check');
    expect(screen.getByRole('button', { name: /upload a screenshot/i })).toBeTruthy();
    await user.upload(screen.getByTestId('screenshot-input'), new File([png], 'chat.png', { type: 'image/png' }));
    expect(await screen.findByText(/we read this from your screenshot/i, {}, { timeout: 20000 })).toBeTruthy();
    expect(screen.getByLabelText(/the message/i).value).toMatch(/501-234567-001/);
    await user.click(screen.getByRole('button', { name: /check this message/i }));
    expect(await screen.findByText(/warning signs|strong signs/i)).toBeTruthy();
  }, 30000);

  it('a non-image file gets a friendly message, not a crash', async () => {
    const user = userEvent.setup({ applyAccept: false });
    await renderAt('#/check');
    await user.upload(screen.getByTestId('screenshot-input'), new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    expect(await screen.findByText(/PNG or JPG screenshot/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });
});

describe('Usability extras', () => {
  it('home links to the Kakis on Telegram', async () => {
    await renderAt('#/');
    const link = screen.getByRole('link', { name: /ask other people \(kakis\)/i });
    expect(link.getAttribute('href')).toBe('https://t.me/SafeKakiTestBot');
  });

  it('the text size button makes all text bigger, then goes back to normal', async () => {
    const user = userEvent.setup();
    await renderAt('#/');
    const btn = screen.getByRole('button', { name: /text size: normal/i });
    await user.click(btn);
    expect(document.documentElement.style.fontSize).toBe('115%');
    await user.click(screen.getByRole('button', { name: /text size: large/i }));
    expect(document.documentElement.style.fontSize).toBe('130%');
    await user.click(screen.getByRole('button', { name: /text size: extra large/i }));
    expect(document.documentElement.style.fontSize).toBe('100%');
  });

  it('the result can be read out loud, and the Kakis card is offered', async () => {
    const spoken = [];
    window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
    window.speechSynthesis = { speak: (u) => spoken.push(u.text), cancel: () => {} };
    try {
      const user = userEvent.setup();
      await renderAt('#/check');
      await user.type(screen.getByLabelText(/the message/i), OTP);
      await user.click(screen.getByRole('button', { name: /check this message/i }));
      await user.click(await screen.findByRole('button', { name: /read this out loud/i }));
      expect(spoken[0]).toMatch(/High risk/);
      expect(spoken[0]).toMatch(/What to do now/);
      expect(screen.getByRole('link', { name: /still not sure\? ask other people/i })).toBeTruthy();
    } finally { delete window.speechSynthesis; delete window.SpeechSynthesisUtterance; }
  });
});
