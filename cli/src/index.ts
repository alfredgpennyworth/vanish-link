#!/usr/bin/env node
import { webcrypto } from 'node:crypto';

const API_BASE = process.env.VANISH_API_URL || 'https://api.vanish.link';
const SITE_BASE = process.env.VANISH_SITE_URL || 'https://vanish.link';
const API_KEY = process.env.VANISH_API_KEY || '';
const subtle = (webcrypto as any).subtle as SubtleCrypto;

// --- Core AES ---
async function aesEncrypt(data: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: "AES-GCM", iv: iv as any }, key, data as any);
  const out = new Uint8Array(iv.length + new Uint8Array(ct).length);
  out.set(iv); out.set(new Uint8Array(ct), iv.length);
  return out;
}

async function aesDecrypt(data: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  const iv = data.slice(0, 12);
  const ct = data.slice(12);
  return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: iv as any }, key, ct as any));
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const km = await subtle.importKey('raw', new TextEncoder().encode(password) as any, 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: "PBKDF2", salt: salt as any, iterations: 600000, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

// --- E2E Encrypt/Decrypt ---
async function e2eEncrypt(plaintext: string, password?: string): Promise<{ ciphertext: string; key: string }> {
  let data: Uint8Array = new TextEncoder().encode(plaintext);
  let salt: Uint8Array | null = null;

  if (password) {
    salt = webcrypto.getRandomValues(new Uint8Array(16));
    const pwKey = await deriveKey(password, salt);
    data = await aesEncrypt(data, pwKey);
  }

  const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const encrypted = await aesEncrypt(data, key);

  let finalCt: Uint8Array;
  if (salt) {
    finalCt = new Uint8Array(salt.length + encrypted.length);
    finalCt.set(salt); finalCt.set(encrypted, salt.length);
  } else {
    finalCt = encrypted;
  }

  const rawKey = await subtle.exportKey('raw', key);
  return { ciphertext: Buffer.from(finalCt).toString('base64'), key: Buffer.from(rawKey).toString('base64') };
}

async function e2eDecrypt(ciphertextB64: string, keyB64: string, password?: string): Promise<string> {
  const rawKey = Buffer.from(keyB64, 'base64');
  const cryptoKey = await subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  let data = new Uint8Array(Buffer.from(ciphertextB64, 'base64'));

  if (password) {
    const salt = data.slice(0, 16);
    const encrypted = data.slice(16);
    const unwrapped = await aesDecrypt(encrypted, cryptoKey);
    const pwKey = await deriveKey(password, salt);
    const plain = await aesDecrypt(unwrapped, pwKey);
    return new TextDecoder().decode(plain);
  } else {
    const plain = await aesDecrypt(data, cryptoKey);
    return new TextDecoder().decode(plain);
  }
}

// --- API ---
async function createLink(content: string, opts: { views?: number; ttl?: number; password?: string }) {
  const { ciphertext, key } = await e2eEncrypt(content, opts.password);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;

  const res = await fetch(`${API_BASE}/api/v1/links`, {
    method: 'POST', headers,
    body: JSON.stringify({ ciphertext, views: opts.views ?? 1, ttl_seconds: opts.ttl ?? 3600, password_protected: !!opts.password }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${await res.text()}`);
  const data = await res.json() as any;
  return { url: `${SITE_BASE}/v/${data.id}#${key}`, ...data };
}

async function consumeLink(urlOrId: string, password?: string): Promise<string> {
  let id: string, key: string;
  if (urlOrId.includes('#')) {
    const hi = urlOrId.indexOf('#'); key = urlOrId.slice(hi + 1);
    id = urlOrId.slice(0, hi).split('/').pop()!;
  } else { id = urlOrId; key = ''; }

  const res = await fetch(`${API_BASE}/api/v1/links/${id}/consume`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  if (!res.ok) { const e = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as any; throw new Error(e.error); }
  const data = await res.json() as any;

  if (data.password_protected && !password) return '\x00PW_REQUIRED\x00' + data.ciphertext;
  return key ? await e2eDecrypt(data.ciphertext, key, data.password_protected ? password : undefined) : data.ciphertext;
}

async function getStatus(id: string) {
  const res = await fetch(`${API_BASE}/api/v1/links/${id}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as any;
}

async function deleteLink(id: string) {
  const res = await fetch(`${API_BASE}/api/v1/links/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

async function promptPassword(prompt = 'Password: '): Promise<string> {
  const { createInterface } = await import('readline');
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    // Disable echo
    if (process.stdin.isTTY) process.stdin.setRawMode!(true);
    process.stderr.write(prompt);
    let pw = '';
    process.stdin.on('data', (ch: Buffer) => {
      const c = ch.toString();
      if (c === '\n' || c === '\r' || c === '\x03') {
        if (process.stdin.isTTY) process.stdin.setRawMode!(false);
        process.stderr.write('\n');
        rl.close();
        if (c === '\x03') process.exit(1);
        resolve(pw);
      } else if (c === '\x7f' || c === '\x08') {
        if (pw.length > 0) { pw = pw.slice(0, -1); process.stderr.write('\b \b'); }
      } else {
        pw += c;
        process.stderr.write('*');
      }
    });
  });
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
  const cmd = cmds.includes(positional[0]) ? positional.shift()! : 'create';
  return { command: cmd, content: positional.join(' '), flags };
}

function parseTTL(s: string): number {
  const m = s.match(/^(\d+)(s|m|h|d)?$/);
  if (!m) throw new Error(`Invalid TTL: ${s}`);
  return parseInt(m[1]) * ({ s:1, m:60, h:3600, d:86400 }[m[2]||'s']||1);
}

function fmtDur(s: number): string {
  if(s<60) return s+'s'; if(s<3600) return Math.floor(s/60)+'m';
  if(s<86400) return Math.floor(s/3600)+'h'; return Math.floor(s/86400)+'d';
}

const HELP = `
\u{1F525} vanish \u2014 zero-knowledge self-destructing links

Usage:
  vanish "secret"                         Create a 1-view E2E link
  vanish "secret" --password              Password-protected (prompts securely)
  vanish "secret" --password mypass       Password inline (less secure)
  vanish --file .env --ttl 5m             From file, 5 min TTL
  echo "secret" | vanish                  From stdin
  vanish read <url>                       Consume & decrypt
  vanish read <url> --password            Decrypt (prompts for password)
  vanish status <id>                      Check status
  vanish burn <id>                        Delete immediately

Options:
  --views <n>        Max views (default: 1)
  --ttl <dur>        Expiry: 30s, 5m, 1h, 7d (default: 1h)
  --password [pw]    Password-protect (prompts if no value; or set VANISH_PASSWORD)
  --file <path>      Read from file
  --raw              URL only (for scripting)
  --json             Full JSON output
`;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 && process.stdin.isTTY) { console.log(HELP); process.exit(0); }
  const { command, content, flags } = parseArgs(args);
  if (flags.help || command === 'help') { console.log(HELP); process.exit(0); }

  try {
    if (command === 'read') {
      if (!content) { console.error('Usage: vanish read <url>'); process.exit(1); }
      let pw = flags.password;
      if (pw === 'true') {
        if (process.env.VANISH_PASSWORD) pw = process.env.VANISH_PASSWORD;
        else if (process.stdin.isTTY) pw = await promptPassword('Password: ');
        else { console.error('Error: --password requires a value, VANISH_PASSWORD env, or a TTY'); process.exit(1); }
      }
      let plaintext = await consumeLink(content, pw);
      if (plaintext.startsWith('\x00PW_REQUIRED\x00')) {
        if (process.env.VANISH_PASSWORD) { pw = process.env.VANISH_PASSWORD; }
        else if (!process.stdin.isTTY) { console.error('Error: This link is password-protected. Use --password or VANISH_PASSWORD env'); process.exit(1); }
        else {
        process.stderr.write('\u{1F511} This link is password-protected.\n');
        pw = await promptPassword('Password: ');
        }
        // We already consumed the link, so decrypt the ciphertext we got back
        const ct = plaintext.slice('\x00PW_REQUIRED\x00'.length);
        const hi = content.indexOf('#'); const key = content.slice(hi + 1);
        plaintext = await e2eDecrypt(ct, key, pw);
      }
      process.stdout.write(plaintext);
      if (process.stdout.isTTY) process.stdout.write('\n');
      return;
    }
    if (command === 'status') {
      if (!content) { console.error('Usage: vanish status <id>'); process.exit(1); }
      const s = await getStatus(content);
      console.log(`\u{1F525} Link: ${content}`);
      console.log(`   Views: ${s.views_total - s.views_remaining}/${s.views_total}`);
      console.log(`   Password: ${s.password_protected ? 'yes' : 'no'}`);
      console.log(`   Expires: ${s.expires_at}`);
      return;
    }
    if (command === 'burn' || command === 'delete') {
      if (!content) { console.error('Usage: vanish burn <id>'); process.exit(1); }
      await deleteLink(content); console.log(`\u{1F525} Burned: ${content}`);
      return;
    }

    let body = content;
    if (flags.file) { const fs = await import('fs'); body = fs.readFileSync(flags.file, 'utf-8'); }
    else if (!body && !process.stdin.isTTY) body = await readStdin();
    if (!body?.trim()) { console.error('Error: No content'); process.exit(1); }

    const views = flags.views ? parseInt(flags.views) : 1;
    const ttl = flags.ttl ? parseTTL(flags.ttl) : 3600;
    let password = flags.password;
    if (password === 'true') {
      if (process.env.VANISH_PASSWORD) password = process.env.VANISH_PASSWORD;
      else if (process.stdin.isTTY) password = await promptPassword('Password: ');
      else { console.error('Error: --password requires a value, VANISH_PASSWORD env, or a TTY'); process.exit(1); }
    }
    const result = await createLink(body.trim(), { views, ttl, password: password || undefined });

    if (flags.raw) process.stdout.write(result.url);
    else if (flags.json) console.log(JSON.stringify({ ...result, e2e: true }, null, 2));
    else {
      console.log(`\u{1F525} ${result.url}`);
      let meta = `   \u{1F512} E2E encrypted \u00B7 ${views} view${views>1?'s':''} \u00B7 expires in ${fmtDur(ttl)}`;
      if (password) meta += ' \u00B7 \u{1F511} password protected';
      console.log(meta);
    }
  } catch (err: any) { console.error(`Error: ${err.message}`); process.exit(1); }
}

main();
