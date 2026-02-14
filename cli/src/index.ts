#!/usr/bin/env node

import { webcrypto } from 'node:crypto';

const API_BASE = process.env.VANISH_API_URL || 'https://vanish.b4sed.workers.dev';
const API_KEY = process.env.VANISH_API_KEY || '';

const subtle = (webcrypto as any).subtle as SubtleCrypto;

// --- E2E Crypto ---

async function e2eEncrypt(plaintext: string): Promise<{ ciphertext: string; key: string }> {
  const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = await subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

  const combined = new Uint8Array(iv.length + new Uint8Array(encrypted).length);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  const rawKey = await subtle.exportKey('raw', key);
  const keyB64 = Buffer.from(rawKey).toString('base64');
  const ciphertextB64 = Buffer.from(combined).toString('base64');

  return { ciphertext: ciphertextB64, key: keyB64 };
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

// --- API ---

interface CreateResponse {
  id: string;
  url: string;
  views_left: number;
  expires_in: number;
  e2e: boolean;
}

async function createLink(content: string, opts: { views?: number; ttl?: number }): Promise<{ url: string; response: CreateResponse }> {
  const { ciphertext, key } = await e2eEncrypt(content);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;

  const res = await fetch(`${API_BASE}/api/v1/links`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ciphertext,
      views: opts.views ?? 1,
      ttl_seconds: opts.ttl ?? 3600,
    }),
  });

  if (!res.ok) throw new Error(`API error: ${res.status} ${await res.text()}`);
  const response = await res.json() as CreateResponse;
  const url = response.url + '#' + key;
  return { url, response };
}

async function consumeLink(urlOrId: string): Promise<string> {
  let id: string;
  let key: string;

  if (urlOrId.includes('#')) {
    const url = new URL(urlOrId);
    id = url.pathname.slice(1);
    key = url.hash.slice(1);
  } else if (urlOrId.includes('/')) {
    const url = new URL(urlOrId);
    id = url.pathname.slice(1);
    key = '';
  } else {
    id = urlOrId;
    key = '';
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;

  const res = await fetch(`${API_BASE}/api/v1/links/${id}/consume`, {
    method: 'POST',
    headers,
    body: '{}',
  });

  if (!res.ok) {
    const err = await res.json() as { error: string };
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  const data = await res.json() as { ciphertext: string; views_remaining: number; burned: boolean };

  if (key) {
    return await e2eDecrypt(data.ciphertext, key);
  }
  return data.ciphertext; // Return raw if no key
}

async function getStatus(id: string) {
  const res = await fetch(`${API_BASE}/api/v1/links/${id}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<{ id: string; views_remaining: number; views_total: number; expires_at: string }>;
}

async function deleteLink(id: string): Promise<void> {
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
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) { flags[key] = next; i++; }
      else flags[key] = 'true';
    } else positional.push(arg);
  }
  const commands = ['create', 'status', 'delete', 'burn', 'read', 'help'];
  const command = commands.includes(positional[0]) ? positional.shift()! : 'create';
  return { command, content: positional.join(' '), flags };
}

function parseTTL(input: string): number {
  const m = input.match(/^(\d+)(s|m|h|d)?$/);
  if (!m) throw new Error(`Invalid TTL: ${input}`);
  return parseInt(m[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 }[m[2] || 's'] || 1);
}

function formatDuration(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s/60)}m`;
  if (s < 86400) return `${Math.floor(s/3600)}h`;
  return `${Math.floor(s/86400)}d`;
}

const HELP = `
🔥 vanish — zero-knowledge self-destructing links

All content is encrypted client-side with AES-256-GCM.
The server never sees your plaintext data.

Usage:
  vanish "secret content"                    Create a 1-view E2E link
  vanish create "content" [options]          Create with options
  vanish --file secrets.txt                  Create from file
  echo "secret" | vanish                     Create from stdin
  vanish read <url>                          Consume & decrypt a link
  vanish status <id>                         Check link status
  vanish burn <id>                           Delete immediately

Options:
  --views <n>        Max views before burn (default: 1)
  --ttl <duration>   Time to live: 30s, 5m, 1h, 7d (default: 1h)
  --file <path>      Read content from file
  --raw              Output only the URL (for piping)
  --json             Output full JSON response

Environment:
  VANISH_API_URL     API endpoint (default: https://vanish.b4sed.workers.dev)
  VANISH_API_KEY     API key for authenticated requests

Examples:
  vanish "sk-abc123"                         Burns after 1 view, E2E encrypted
  vanish "db password" --views 3 --ttl 24h   3 views, expires in 24h
  KEY_URL=$(vanish "secret" --raw)           Capture URL for scripting
  vanish read "$KEY_URL"                     Decrypt & consume
`;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 && process.stdin.isTTY) { console.log(HELP); process.exit(0); }

  const { command, content, flags } = parseArgs(args);
  if (flags.help || command === 'help') { console.log(HELP); process.exit(0); }

  try {
    if (command === 'read') {
      const url = content || flags.url || '';
      if (!url) { console.error('Usage: vanish read <url>'); process.exit(1); }
      const plaintext = await consumeLink(url);
      process.stdout.write(plaintext);
      if (process.stdout.isTTY) process.stdout.write('\n');
      return;
    }

    if (command === 'status') {
      const id = content || flags.id || '';
      if (!id) { console.error('Usage: vanish status <id>'); process.exit(1); }
      const s = await getStatus(id);
      console.log(`🔥 Link: ${id}`);
      console.log(`   Views: ${s.views_total - s.views_remaining}/${s.views_total} used`);
      console.log(`   Remaining: ${s.views_remaining}`);
      console.log(`   Expires: ${s.expires_at}`);
      return;
    }

    if (command === 'burn' || command === 'delete') {
      const id = content || flags.id || '';
      if (!id) { console.error('Usage: vanish burn <id>'); process.exit(1); }
      await deleteLink(id);
      console.log(`🔥 Burned: ${id}`);
      return;
    }

    // Create
    let body = content;
    if (flags.file) {
      const fs = await import('fs');
      body = fs.readFileSync(flags.file, 'utf-8');
    } else if (!body && !process.stdin.isTTY) {
      body = await readStdin();
    }

    if (!body?.trim()) { console.error('Error: No content provided'); process.exit(1); }

    const views = flags.views ? parseInt(flags.views) : 1;
    const ttl = flags.ttl ? parseTTL(flags.ttl) : 3600;

    const { url, response } = await createLink(body.trim(), { views, ttl });

    if (flags.raw) {
      process.stdout.write(url);
    } else if (flags.json) {
      console.log(JSON.stringify({ ...response, url, e2e: true }, null, 2));
    } else {
      console.log(`🔥 ${url}`);
      console.log(`   🔒 E2E encrypted · ${views} view${views>1?'s':''} · expires in ${formatDuration(ttl)}`);
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
