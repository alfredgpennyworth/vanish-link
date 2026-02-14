#!/usr/bin/env node

import { webcrypto } from 'node:crypto';

const API_BASE = process.env.VANISH_API_URL || 'https://vanish-api.b4sed.workers.dev';
const SITE_BASE = process.env.VANISH_SITE_URL || 'https://vanish-link-8y6.pages.dev';
const API_KEY = process.env.VANISH_API_KEY || '';

const subtle = (webcrypto as any).subtle as SubtleCrypto;

async function e2eEncrypt(plaintext: string): Promise<{ ciphertext: string; key: string }> {
  const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = await subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const combined = new Uint8Array(iv.length + new Uint8Array(encrypted).length);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  const rawKey = await subtle.exportKey('raw', key);
  return {
    ciphertext: Buffer.from(combined).toString('base64'),
    key: Buffer.from(rawKey).toString('base64'),
  };
}

async function e2eDecrypt(ciphertextB64: string, keyB64: string): Promise<string> {
  const rawKey = Buffer.from(keyB64, 'base64');
  const key = await subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  const data = Buffer.from(ciphertextB64, 'base64');
  const iv = data.slice(0, 12);
  const encrypted = data.slice(12);
  const decrypted = await subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
  return new TextDecoder().decode(decrypted);
}

async function createLink(content: string, opts: { views?: number; ttl?: number }) {
  const { ciphertext, key } = await e2eEncrypt(content);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;

  const res = await fetch(`${API_BASE}/api/v1/links`, {
    method: 'POST', headers,
    body: JSON.stringify({ ciphertext, views: opts.views ?? 1, ttl_seconds: opts.ttl ?? 3600 }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${await res.text()}`);
  const data = await res.json() as { id: string; views_left: number; expires_in: number };
  const url = `${SITE_BASE}/v/${data.id}#${key}`;
  return { url, ...data };
}

async function consumeLink(urlOrId: string): Promise<string> {
  let id: string, key: string;

  if (urlOrId.includes('#')) {
    const hashIdx = urlOrId.indexOf('#');
    key = urlOrId.slice(hashIdx + 1);
    const before = urlOrId.slice(0, hashIdx);
    // Extract ID from URL path: /v/ID or just /ID
    const parts = before.split('/');
    id = parts[parts.length - 1];
  } else {
    id = urlOrId;
    key = '';
  }

  const res = await fetch(`${API_BASE}/api/v1/links/${id}/consume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error: string };
    throw new Error(err.error);
  }

  const data = await res.json() as { ciphertext: string };
  if (key) return await e2eDecrypt(data.ciphertext, key);
  return data.ciphertext;
}

async function getStatus(id: string) {
  const res = await fetch(`${API_BASE}/api/v1/links/${id}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<{ id: string; views_remaining: number; views_total: number; expires_at: string }>;
}

async function deleteLink(id: string) {
  const res = await fetch(`${API_BASE}/api/v1/links/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

function parseArgs(args: string[]) {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) { const k = a.slice(2); const n = args[i+1]; if (n && !n.startsWith('--')) { flags[k] = n; i++; } else flags[k] = 'true'; }
    else positional.push(a);
  }
  const cmds = ['create','status','delete','burn','read','help'];
  const command = cmds.includes(positional[0]) ? positional.shift()! : 'create';
  return { command, content: positional.join(' '), flags };
}

function parseTTL(s: string): number {
  const m = s.match(/^(\d+)(s|m|h|d)?$/);
  if (!m) throw new Error(`Invalid TTL: ${s}`);
  return parseInt(m[1]) * ({ s:1, m:60, h:3600, d:86400 }[m[2]||'s']||1);
}

function fmtDur(s: number): string {
  if (s<60) return s+'s'; if (s<3600) return Math.floor(s/60)+'m';
  if (s<86400) return Math.floor(s/3600)+'h'; return Math.floor(s/86400)+'d';
}

const HELP = `
🔥 vanish — zero-knowledge self-destructing links

All content is E2E encrypted (AES-256-GCM) client-side.
API and viewer run on separate origins — true zero knowledge.

Usage:
  vanish "secret"                  Create a 1-view E2E link
  vanish --file .env --ttl 5m      From file, 5 min TTL
  echo "secret" | vanish           From stdin
  vanish read <url>                Consume & decrypt
  vanish status <id>               Check status
  vanish burn <id>                 Delete immediately

Options:
  --views <n>      Max views (default: 1)
  --ttl <dur>      Expiry: 30s, 5m, 1h, 7d (default: 1h)
  --file <path>    Read from file
  --raw            URL only (for scripting)
  --json           Full JSON output
`;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 && process.stdin.isTTY) { console.log(HELP); process.exit(0); }
  const { command, content, flags } = parseArgs(args);
  if (flags.help || command === 'help') { console.log(HELP); process.exit(0); }

  try {
    if (command === 'read') {
      if (!content) { console.error('Usage: vanish read <url>'); process.exit(1); }
      const plaintext = await consumeLink(content);
      process.stdout.write(plaintext);
      if (process.stdout.isTTY) process.stdout.write('\n');
      return;
    }
    if (command === 'status') {
      if (!content) { console.error('Usage: vanish status <id>'); process.exit(1); }
      const s = await getStatus(content);
      console.log(`🔥 Link: ${content}`);
      console.log(`   Views: ${s.views_total - s.views_remaining}/${s.views_total}`);
      console.log(`   Expires: ${s.expires_at}`);
      return;
    }
    if (command === 'burn' || command === 'delete') {
      if (!content) { console.error('Usage: vanish burn <id>'); process.exit(1); }
      await deleteLink(content);
      console.log(`🔥 Burned: ${content}`);
      return;
    }

    let body = content;
    if (flags.file) { const fs = await import('fs'); body = fs.readFileSync(flags.file, 'utf-8'); }
    else if (!body && !process.stdin.isTTY) body = await readStdin();
    if (!body?.trim()) { console.error('Error: No content'); process.exit(1); }

    const views = flags.views ? parseInt(flags.views) : 1;
    const ttl = flags.ttl ? parseTTL(flags.ttl) : 3600;
    const result = await createLink(body.trim(), { views, ttl });

    if (flags.raw) process.stdout.write(result.url);
    else if (flags.json) console.log(JSON.stringify({ ...result, e2e: true }, null, 2));
    else {
      console.log(`🔥 ${result.url}`);
      console.log(`   🔒 E2E encrypted · ${views} view${views>1?'s':''} · expires in ${fmtDur(ttl)}`);
    }
  } catch (err: any) { console.error(`Error: ${err.message}`); process.exit(1); }
}

main();
