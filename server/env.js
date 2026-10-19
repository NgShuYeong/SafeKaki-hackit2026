// Loads <project root>/.env no matter which folder you start the program from,
// and copes with files saved by Windows tools (UTF-8 with BOM, or UTF-16).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENV_PATH = path.join(ROOT, '.env');

export function loadEnv(file = ENV_PATH, env = process.env) {
  if (!fs.existsSync(file)) return { loaded: false, path: file, keys: [] };
  const buf = fs.readFileSync(file);
  const text = (buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8')).replace(/^\uFEFF/, '');
  const parsed = dotenv.parse(text);
  const clean = (v) => String(v).trim().replace(/^(["'])(.*)\1$/, '$2').trim();
  for (const [k, v] of Object.entries(parsed)) if (env[k] === undefined || env[k] === '') env[k] = clean(v);
  return { loaded: true, path: file, keys: Object.keys(parsed) };
}

export const envStatus = loadEnv();
