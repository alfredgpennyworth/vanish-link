#!/usr/bin/env node

const API_BASE = process.env.VANISH_API_URL || 'https://vanish.b4sed.workers.dev';
const API_KEY = process.env.VANISH_API_KEY || '';

interface CreateResponse {
  id: string;
  url: string;
  views_left: number;
  expires_in: number;
}

interface LinkStatus {
  id: string;
  views_remaining: number;
  views_total: number;
  created_at: string;
  expires_at: string;
}

async function createLink(content: string, opts: { views?: number; ttl?: number; password?: string }): Promise<CreateResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;

  const res = await fetch(`${API_BASE}/api/v1/links`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      content,
      views: opts.views ?? 1,
      ttl_seconds: opts.ttl ?? 3600,
      password: opts.password,
    }),
  });

  if (!res.ok) throw new Error(`API error: ${res.status} ${await res.text()}`);
  return res.json() as Promise<CreateResponse>;
}

async function getStatus(id: string): Promise<LinkStatus> {
  const headers: Record<string, string> = {};
  if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;

  const res = await fetch(`${API_BASE}/api/v1/links/${id}`, { headers });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<LinkStatus>;
}

async function deleteLink(id: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;

  const res = await fetch(`${API_BASE}/api/v1/links/${id}`, { method: 'DELETE', headers });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function parseArgs(args: string[]): { command: string; content: string; flags: Record<string, string> } {
  const flags: Record<string, string> = {};
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = 'true';
      }
    } else {
      positional.push(arg);
    }
  }

  const command = positional[0] || 'create';
  const content = positional.slice(command === 'create' || command === 'status' || command === 'delete' || command === 'burn' ? 1 : 0).join(' ');

  return { command, content, flags };
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function parseTTL(input: string): number {
  const match = input.match(/^(\d+)(s|m|h|d)?$/);
  if (!match) throw new Error(`Invalid TTL: ${input}`);
  const n = parseInt(match[1]);
  const unit = match[2] || 's';
  return n * ({ s: 1, m: 60, h: 3600, d: 86400 }[unit] || 1);
}

const HELP = `
🔥 vanish — self-destructing links for agents and humans

Usage:
  vanish "secret content"                    Create a 1-view link (default)
  vanish create "content" [options]          Create with options
  vanish --file secrets.txt                  Create from file
  echo "secret" | vanish                     Create from stdin
  vanish status <id>                         Check link status
  vanish burn <id>                           Delete a link immediately
  vanish delete <id>                         Alias for burn

Options:
  --views <n>        Max views before burn (default: 1)
  --ttl <duration>   Time to live: 30s, 5m, 1h, 7d (default: 1h)
  --password <pw>    Require password to view
  --file <path>      Read content from file
  --raw              Output only the URL (for piping)
  --json             Output full JSON response

Environment:
  VANISH_API_URL     API endpoint (default: https://vanish.b4sed.workers.dev)
  VANISH_API_KEY     API key for authenticated requests

Examples:
  vanish "sk-abc123"                         Burns after 1 view
  vanish "db password" --views 3 --ttl 24h   3 views, expires in 24h
  vanish --file .env --ttl 5m                File content, 5 min TTL
  KEY=$(vanish "secret" --raw)               Capture URL in variable
  cat key.pem | vanish --ttl 10m             Pipe content
`;

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 && process.stdin.isTTY) {
    console.log(HELP);
    process.exit(0);
  }

  const { command, content, flags } = parseArgs(args);

  if (flags.help || command === 'help') {
    console.log(HELP);
    process.exit(0);
  }

  try {
    if (command === 'status') {
      const id = content || flags.id || '';
      if (!id) { console.error('Usage: vanish status <id>'); process.exit(1); }
      const status = await getStatus(id);
      console.log(`🔥 Link: ${id}`);
      console.log(`   Views: ${status.views_total - status.views_remaining}/${status.views_total} used`);
      console.log(`   Remaining: ${status.views_remaining}`);
      console.log(`   Expires: ${status.expires_at}`);
      return;
    }

    if (command === 'burn' || command === 'delete') {
      const id = content || flags.id || '';
      if (!id) { console.error('Usage: vanish burn <id>'); process.exit(1); }
      await deleteLink(id);
      console.log(`🔥 Burned: ${id}`);
      return;
    }

    // Create mode
    let body = content;

    if (flags.file) {
      const fs = await import('fs');
      body = fs.readFileSync(flags.file, 'utf-8');
    } else if (!body && !process.stdin.isTTY) {
      body = await readStdin();
    }

    if (!body?.trim()) {
      console.error('Error: No content provided');
      console.error('Usage: vanish "your secret content"');
      process.exit(1);
    }

    const views = flags.views ? parseInt(flags.views) : 1;
    const ttl = flags.ttl ? parseTTL(flags.ttl) : 3600;

    const result = await createLink(body.trim(), { views, ttl, password: flags.password });

    if (flags.raw) {
      process.stdout.write(result.url);
    } else if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`🔥 ${result.url}`);
      console.log(`   Views: ${result.views_left} │ Expires: ${formatDuration(result.expires_in)}`);
      if (flags.password) console.log(`   🔒 Password protected`);
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
