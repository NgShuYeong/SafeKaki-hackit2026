// The bot uses the SAME analysis and report code as the web app.
//  - default: imports the shared core in-process (one process, nothing duplicated)
//  - SAFEKAKI_API_URL set: calls the HTTP API instead (bot and server can run on different machines)
import { analyzeMessage } from '../server/core/analyze.js';
import { buildReportDraft } from '../server/core/report.js';
import { findNamesWithAi } from '../server/core/redactNames.js';
import { readImage, ImageError } from '../server/core/readImage.js';

export function makeBackend({ apiUrl = process.env.SAFEKAKI_API_URL, secret = process.env.BOT_SHARED_SECRET, fetchImpl = fetch } = {}) {
  if (!apiUrl) {
    return {
      mode: 'in-process',
      analyze: async (input) => analyzeMessage(input),
      draft: async (input) => buildReportDraft(input),
      findNames: async ({ text }) => ({ ok: true, ...(await findNamesWithAi(text)) }),
      readImage: async ({ image }) => {
        try { return { ok: true, ...(await readImage(image)) }; }
        catch (e) { return { ok: false, code: e.code || 'internal', error: e instanceof ImageError ? e.message : 'Sorry, I could not read that picture.' }; }
      },
    };
  }
  const base = apiUrl.replace(/\/$/, '');
  const post = async (path, body, clientId) => {
    const headers = { 'content-type': 'application/json' };
    if (secret && clientId) { headers['x-safekaki-secret'] = secret; headers['x-safekaki-client'] = String(clientId); }
    const res = await fetchImpl(base + path, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
    return res.json();
  };
  return {
    mode: 'http',
    analyze: (input) => post('/api/analyze', input, input.clientId),
    draft: (input) => post('/api/report/draft', input, input.clientId),
    findNames: (input) => post('/api/share/names', { text: input.text }, input.clientId),
    readImage: (input) => post('/api/read-image', { image: input.image.toString('base64') }, input.clientId),
  };
}
