/**
 * Shared helpers for the setup scripts.
 *
 * No dependencies on purpose: these run before `npm install` has necessarily
 * finished, and the first thing a new user meets should not be a missing module.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const ENV_FILE = resolve(process.cwd(), '.env.local');

/** Parse a dotenv file into an object. Handles quotes and comments, nothing else. */
export function parseEnv(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Load .env.local into process.env without overwriting anything already set. */
export function loadEnv(file = ENV_FILE) {
  if (!existsSync(file)) return {};
  const values = parseEnv(readFileSync(file, 'utf8'));
  for (const [k, v] of Object.entries(values)) {
    if (process.env[k] === undefined || process.env[k] === '') process.env[k] = v;
  }
  return values;
}

/** Write .env.local, keeping the comments of .env.example around the values. */
export function writeEnv(values, file = ENV_FILE) {
  const example = existsSync('.env.example') ? readFileSync('.env.example', 'utf8') : '';
  const seen = new Set();
  const lines = example.split('\n').map((line) => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (!m) return line;
    const key = m[1];
    seen.add(key);
    return values[key] !== undefined ? `${key}=${values[key]}` : line;
  });
  for (const [k, v] of Object.entries(values)) {
    if (!seen.has(k)) lines.push(`${k}=${v}`);
  }
  writeFileSync(file, `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`, { mode: 0o600 });
}

export const ok = (msg) => console.log(`  ok    ${msg}`);
export const bad = (msg) => console.log(`  FAIL  ${msg}`);
export const info = (msg) => console.log(`        ${msg}`);
export const head = (msg) => console.log(`\n${msg}`);

/** Never print a secret. This is what shows up in logs instead. */
export const mask = (value) => (!value ? '(unset)' : `${value.slice(0, 4)}...${value.slice(-3)} (${value.length} chars)`);

export async function telegram(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description ?? `HTTP ${res.status}`);
  return data.result;
}

/** Ask a question on the terminal. Returns the trimmed answer. */
export async function ask(question, { fallback = '', secret = false } = {}) {
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const suffix = fallback ? ` [${secret ? mask(fallback) : fallback}]` : '';
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  rl.close();
  return answer || fallback;
}
