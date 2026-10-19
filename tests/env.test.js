import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnv } from '../server/env.js';

const tmp = (name, buf) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'env-')), name); fs.writeFileSync(f, buf); return f; };
const TOKEN = '123456789:ABCdefGhIJKlmNoPQRsTUVwxyz012345678';

test('reads plain UTF-8, UTF-8 with BOM, and UTF-16 (PowerShell ">") files; strips quotes and spaces', () => {
  const variants = {
    plain: Buffer.from(`TELEGRAM_BOT_TOKEN=${TOKEN}\n`),
    bom: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`TELEGRAM_BOT_TOKEN=${TOKEN}\r\n`)]),
    utf16: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`TELEGRAM_BOT_TOKEN=${TOKEN}\r\n`, 'utf16le')]),
    quoted: Buffer.from(`TELEGRAM_BOT_TOKEN = "${TOKEN}"  \n`),
  };
  for (const [name, buf] of Object.entries(variants)) {
    const env = {};
    const r = loadEnv(tmp('.env', buf), env);
    assert.equal(r.loaded, true, name);
    assert.equal(env.TELEGRAM_BOT_TOKEN, TOKEN, name);
  }
});
test('missing file is reported, existing environment values are not overwritten', () => {
  assert.equal(loadEnv('/nonexistent/.env', {}).loaded, false);
  const env = { LLM_API_KEY: 'from-shell' };
  loadEnv(tmp('.env', Buffer.from('LLM_API_KEY=from-file\n')), env);
  assert.equal(env.LLM_API_KEY, 'from-shell');
});
