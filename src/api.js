const BASE = import.meta.env.VITE_API_BASE || '';

export class ApiError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

async function request(path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!data) {
      // Not a SafeKaki reply (empty or HTML). Usually the checking server is not running.
      throw new ApiError('The SafeKaki checking server is not running or cannot be reached. If you are running this yourself, start it with "npm run dev:all" (or "npm run server" in a second terminal). If it is urgent, call the ScamShield Helpline 1799.', 'server_down');
    }
    if (!res.ok || !data.ok) throw new ApiError(data.error || 'Something went wrong. Please try again.', data.code || 'unknown');
    return data;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e?.name === 'AbortError') throw new ApiError('This is taking too long. Please try again in a moment.', 'timeout');
    throw new ApiError('SafeKaki cannot be reached right now. Check your internet connection and try again. If it is urgent, call the ScamShield Helpline 1799.', 'network');
  } finally {
    clearTimeout(timer);
  }
}

export const analyzeMessage = (message) => request('/api/analyze', { message });
export const draftReport = (message, details) => request('/api/report/draft', { message, details });
export const findNamesToHide = (text) => request('/api/share/names', { text });
export const readScreenshot = (dataUrl) => request('/api/read-image', { image: dataUrl });
