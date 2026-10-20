// Temporary Kaki discussion rooms.
// Telegram bots cannot create group chats, so a "room" lives inside each person's private
// chat with the bot: the bot copies every message to the other people in the room.
// Room chats are kept in memory only and deleted when the room closes. What is saved to disk:
//   kakis.json           the Telegram user IDs of people who opted in as helpers
//   room-summaries.json  the closing summaries (no chat log, no user IDs)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOM_IDLE_MS = 20 * 60 * 1000;
export const ROOM_MAX_MS = 60 * 60 * 1000;
export const ROOM_MAX_PEOPLE = 6;
export const REPORTS_TO_REMOVE = 2;
export const MAX_ROOM_MESSAGE = 1000;
const MAX_SAVED_SUMMARIES = 500;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I/L, easy to read aloud

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  } catch { /* saving is best effort; the bot keeps working from memory */ }
}

/** Makes links in room chat unclickable, e.g. https://dbs-x.top -> hxxps://dbs-x[.]top */
export function defangLinks(text) {
  return String(text)
    .replace(/\bhttp(s?):\/\//gi, 'hxxp$1://')
    .replace(/\b((?:[a-z0-9-]+\.)+)([a-z]{2,24})\b/gi, (m, head, tld) => {
      // Leave ordinary words like "e.g." or "a.m." alone: needs a real-looking host.
      if (!/[a-z0-9-]{2,}\./i.test(head)) return m;
      return head.replace(/\./g, '[.]') + tld;
    });
}

export function createRooms({ dataDir, now = () => Date.now(), idleMs = ROOM_IDLE_MS, maxMs = ROOM_MAX_MS, maxPeople = ROOM_MAX_PEOPLE } = {}) {
  const kakiFile = dataDir ? path.join(dataDir, 'kakis.json') : null;
  const summaryFile = dataDir ? path.join(dataDir, 'room-summaries.json') : null;
  const helpers = new Set((kakiFile ? readJson(kakiFile, { helpers: [] }).helpers : []).map(String));
  const rooms = new Map(); // code -> room
  const userRoom = new Map(); // userId -> code
  const lastPinged = new Map(); // userId -> time, so pings are shared out fairly

  const saveHelpers = () => kakiFile && writeJson(kakiFile, { helpers: [...helpers] });

  function newCode() {
    for (;;) {
      const bytes = crypto.randomBytes(4);
      const code = [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
      if (!rooms.has(code)) return code;
    }
  }

  // ---- helpers (opt-in Kakis) ----
  const isHelper = (id) => helpers.has(String(id));
  function setHelper(id, on) {
    if (on) helpers.add(String(id)); else helpers.delete(String(id));
    saveHelpers();
  }
  /** Helpers to ping for a new room: not the asker, not busy in another room, least recently pinged first. */
  function pickHelpers(excludeId, max = 8) {
    const free = [...helpers].filter((id) => id !== String(excludeId) && !userRoom.has(id));
    free.sort((a, b) => (lastPinged.get(a) || 0) - (lastPinged.get(b) || 0) || Math.random() - 0.5);
    const picked = free.slice(0, max);
    for (const id of picked) lastPinged.set(id, now());
    return picked;
  }

  // ---- rooms ----
  const roomOf = (userId) => { const c = userRoom.get(String(userId)); return c ? rooms.get(c) || null : null; };
  const get = (code) => rooms.get(String(code || '').toUpperCase()) || null;
  const openRooms = () => [...rooms.values()].filter((r) => !r.closed);
  const others = (room, userId) => [...room.members.keys()].filter((id) => id !== String(userId));

  function create({ ownerId, original, riskLevel, category, headline }) {
    const code = newCode();
    const t = now();
    const room = {
      code, ownerId: String(ownerId), original, riskLevel, category, headline,
      members: new Map(), // userId -> alias
      aliases: new Map(), // userId -> alias, kept after they leave so names stay stable
      everJoined: new Set(), removed: new Set(), reports: new Map(), // userId -> Set(reporterIds)
      votes: new Map(), transcript: [], nextKaki: 1,
      createdAt: t, lastActivity: t, closed: false,
    };
    rooms.set(code, room);
    join(code, ownerId);
    return room;
  }

  /** @returns {{ok:true, room, alias, rejoined:boolean} | {ok:false, reason:'gone'|'full'|'busy'|'removed'}} */
  function join(code, userId, { demo = false } = {}) {
    const room = get(code);
    const id = String(userId);
    if (!room || room.closed) return { ok: false, reason: 'gone' };
    if (room.removed.has(id)) return { ok: false, reason: 'removed' };
    if (room.members.has(id)) return { ok: true, room, alias: room.members.get(id), rejoined: true };
    if (userRoom.has(id)) return { ok: false, reason: 'busy' };
    if (room.members.size >= maxPeople) return { ok: false, reason: 'full' };
    let alias = room.aliases.get(id);
    if (!alias) { alias = id === room.ownerId ? 'Asker' : `Kaki ${room.nextKaki++}${demo ? ' (demo)' : ''}`; room.aliases.set(id, alias); }
    const rejoined = room.everJoined.has(id);
    room.members.set(id, alias);
    room.everJoined.add(id);
    userRoom.set(id, room.code);
    room.lastActivity = now();
    return { ok: true, room, alias, rejoined };
  }

  /** @returns {{room, alias, empty:boolean} | null} */
  function leave(userId) {
    const room = roomOf(userId);
    if (!room) return null;
    const id = String(userId);
    const alias = room.members.get(id);
    room.members.delete(id);
    userRoom.delete(id);
    room.lastActivity = now();
    return { room, alias, empty: room.members.size === 0 };
  }

  function say(userId, text) {
    const room = roomOf(userId);
    if (!room) return null;
    const alias = room.members.get(String(userId));
    const clean = String(text).slice(0, MAX_ROOM_MESSAGE);
    room.transcript.push({ alias, text: clean });
    room.lastActivity = now();
    return { room, alias, text: clean, to: others(room, userId) };
  }

  function vote(code, userId, choice) {
    const room = get(code);
    if (!room || room.closed || !room.everJoined.has(String(userId)) || !['scam', 'unsure', 'real'].includes(choice)) return false;
    room.votes.set(String(userId), choice);
    return true;
  }

  /** @returns {{ok:boolean, removedId?:string, alias?:string}} */
  function report(code, reporterId, alias) {
    const room = get(code);
    if (!room || room.closed || !room.members.has(String(reporterId))) return { ok: false };
    const target = [...room.members.entries()].find(([, a]) => a === alias)?.[0];
    if (!target || target === String(reporterId)) return { ok: false };
    const by = room.reports.get(target) || new Set();
    by.add(String(reporterId));
    room.reports.set(target, by);
    if (by.size >= REPORTS_TO_REMOVE) {
      room.members.delete(target);
      room.removed.add(target);
      userRoom.delete(target);
      room.votes.delete(target);
      return { ok: true, removedId: target, alias };
    }
    return { ok: true };
  }

  /** Rooms that should close now: [{ room, reason: 'max' | 'idle' }] */
  function expired() {
    const t = now();
    const out = [];
    for (const room of openRooms()) {
      if (t - room.createdAt >= maxMs) out.push({ room, reason: 'max' });
      else if (t - room.lastActivity >= idleMs) out.push({ room, reason: 'idle' });
    }
    return out;
  }

  /** Closes a room: everyone is taken out, the chat log is wiped. Returns what the summary needs. */
  function close(code) {
    const room = get(code);
    if (!room || room.closed) return null;
    room.closed = true;
    for (const id of room.members.keys()) userRoom.delete(id);
    const snapshot = {
      code: room.code, original: room.original, riskLevel: room.riskLevel, category: room.category,
      transcript: room.transcript, votes: [...room.votes.values()],
      recipients: [...room.everJoined].filter((id) => !room.removed.has(id)),
      peopleCount: room.everJoined.size,
    };
    room.transcript = [];
    room.members.clear();
    rooms.delete(room.code);
    return snapshot;
  }

  function saveSummary(entry) {
    if (!summaryFile) return;
    const all = readJson(summaryFile, []);
    all.push(entry);
    writeJson(summaryFile, all.slice(-MAX_SAVED_SUMMARIES));
  }

  return { maxPeople, isHelper, setHelper, helperCount: () => helpers.size, pickHelpers, create, join, leave, say, vote, report, expired, close, roomOf, get, openRooms, others, saveSummary };
}
