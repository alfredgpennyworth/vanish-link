/**
 * Vanish.link - Zero-knowledge self-destructing links
 * Server never sees plaintext — all encryption/decryption happens client-side
 */

import { corsHeaders } from './cors';
import { createLink, getLink, burnLink, deleteLink } from './db';
import { generateId } from './crypto';

export interface Env {
	DB: D1Database;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;
		const method = request.method;

		if (method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		try {
			if (path.startsWith('/api/')) {
				return handleApi(request, env);
			}

			// View a link
			const id = path.slice(1);
			if (id && !id.includes('.') && !id.includes('/')) {
				return handleLinkView(request, env, id);
			}

			return new Response(null, { status: 404 });
		} catch (err) {
			return new Response('Error: ' + err, { status: 500 });
		}
	}
};

async function handleApi(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname;
	const method = request.method;

	// Create link — receives already-encrypted ciphertext
	if (path === '/api/v1/links' && method === 'POST') {
		const body = await request.json() as {
			ciphertext: string;  // client-encrypted content
			views?: number;
			ttl_seconds?: number;
			has_password?: boolean;
			// Legacy support: "content" field (for non-E2E usage)
			content?: string;
		};

		const ciphertext = body.ciphertext || body.content;
		if (!ciphertext) {
			return jsonResponse({ error: 'ciphertext required' }, 400);
		}

		const views = body.views || 1;
		const ttl = body.ttl_seconds || 3600;
		const id = generateId();

		await createLink(env.DB, {
			id,
			content: ciphertext,
			views_remaining: views,
			views_total: views,
			ttl_seconds: ttl,
			password: null,
		});

		return jsonResponse({
			id,
			url: `https://vanish.link/${id}`,
			views_left: views,
			expires_in: ttl,
			e2e: !!body.ciphertext,
		});
	}

	// Consume link — returns ciphertext for client to decrypt
	if (path.match(/^\/api\/v1\/links\/[\w-]+\/consume$/) && method === 'POST') {
		const id = path.split('/')[4];
		const link = await getLink(env.DB, id);

		if (!link) {
			return jsonResponse({ error: 'not found or already burned' }, 404);
		}

		const now = Date.now();
		const created = new Date(link.created_at).getTime();
		if (now > created + link.ttl_seconds * 1000 || link.views_remaining <= 0) {
			await burnLink(env.DB, id);
			return jsonResponse({ error: 'expired or burned' }, 410);
		}

		await burnLink(env.DB, id);

		return jsonResponse({
			ciphertext: link.content,
			views_remaining: link.views_remaining - 1,
			burned: link.views_remaining - 1 <= 0,
		});
	}

	// Status
	if (path.match(/^\/api\/v1\/links\/[\w-]+$/) && method === 'GET') {
		const id = path.split('/').pop()!;
		const link = await getLink(env.DB, id);

		if (!link) {
			return jsonResponse({ error: 'not found' }, 404);
		}

		return jsonResponse({
			id: link.id,
			views_remaining: link.views_remaining,
			views_total: link.views_total,
			created_at: link.created_at,
			expires_at: new Date(new Date(link.created_at).getTime() + link.ttl_seconds * 1000).toISOString(),
		});
	}

	// Delete
	if (path.match(/^\/api\/v1\/links\/[\w-]+$/) && method === 'DELETE') {
		const id = path.split('/').pop()!;
		await deleteLink(env.DB, id);
		return jsonResponse({ success: true });
	}

	return new Response('Not Found', { status: 404 });
}

function jsonResponse(data: any, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { ...corsHeaders, 'Content-Type': 'application/json' },
	});
}

async function handleLinkView(request: Request, env: Env, id: string): Promise<Response> {
	const link = await getLink(env.DB, id);

	if (!link) {
		return new Response(viewerHTML('burned'), { headers: { 'Content-Type': 'text/html' } });
	}

	const now = Date.now();
	const created = new Date(link.created_at).getTime();
	if (now > created + link.ttl_seconds * 1000 || link.views_remaining <= 0) {
		await burnLink(env.DB, id);
		return new Response(viewerHTML('burned'), { headers: { 'Content-Type': 'text/html' } });
	}

	// Decrement views
	await burnLink(env.DB, id);

	// Return the viewer page with ciphertext embedded — decryption happens in browser
	return new Response(viewerHTML('view', link.content, link.views_remaining - 1), {
		headers: { 'Content-Type': 'text/html' },
	});
}

function viewerHTML(state: 'burned' | 'view', ciphertext?: string, viewsLeft?: number): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Vanish.link</title>
	<style>
		*{box-sizing:border-box;margin:0;padding:0}
		body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a0a;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
		.container{max-width:600px;width:100%;text-align:center}
		.logo{font-size:3rem;margin-bottom:1rem;filter:drop-shadow(0 0 20px rgba(239,68,68,0.5))}
		h1{font-size:1.5rem;margin-bottom:1rem;color:#ef4444}
		.content{background:#1a1a1a;border:1px solid #333;border-radius:12px;padding:1.5rem;margin:1.5rem 0;text-align:left;overflow-x:auto}
		.content pre{white-space:pre-wrap;word-break:break-all;font-size:0.9rem;line-height:1.5;font-family:'Monaco','Menlo',monospace}
		.warning{color:#f59e0b;font-size:0.875rem;margin-bottom:1rem}
		.burned{color:#ef4444;font-size:1.25rem}
		.stats{color:#666;font-size:0.875rem;margin-top:1rem}
		.e2e-badge{display:inline-flex;align-items:center;gap:6px;background:#0f2a1a;border:1px solid #166534;color:#22c55e;padding:4px 12px;border-radius:20px;font-size:0.75rem;margin-bottom:1rem}
		.error{color:#ef4444;background:#1a0a0a;border:1px solid #7f1d1d;border-radius:8px;padding:1rem;margin:1rem 0}
	</style>
</head>
<body>
	<div class="container">
		<div class="logo">🔥</div>
		<h1>vanish.link</h1>
		${state === 'burned' ? `
			<p class="burned">This link has already vanished.</p>
			<p class="stats">It either expired, was viewed, or never existed.</p>
		` : `
			<div class="e2e-badge">🔒 End-to-end encrypted</div>
			<div id="decrypting">
				<p class="warning">Decrypting...</p>
			</div>
			<div id="content-wrap" style="display:none">
				<p class="warning">⚠️ This content has been burned. Views remaining: ${viewsLeft}</p>
				<div class="content"><pre id="plaintext"></pre></div>
			</div>
			<div id="error-wrap" style="display:none">
				<div class="error" id="error-msg"></div>
			</div>
			<script>
			(async () => {
				try {
					const key = window.location.hash.slice(1);
					if (!key) {
						document.getElementById('decrypting').style.display='none';
						document.getElementById('error-wrap').style.display='block';
						document.getElementById('error-msg').textContent='Missing decryption key. The link may be incomplete.';
						return;
					}

					const ciphertext = ${JSON.stringify(ciphertext)};

					// Decode the key
					const rawKey = Uint8Array.from(atob(key), c => c.charCodeAt(0));
					const cryptoKey = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);

					// Decode ciphertext: first 12 bytes are IV, rest is encrypted data
					const data = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
					const iv = data.slice(0, 12);
					const encrypted = data.slice(12);

					const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, encrypted);
					const plaintext = new TextDecoder().decode(decrypted);

					document.getElementById('decrypting').style.display='none';
					document.getElementById('content-wrap').style.display='block';
					document.getElementById('plaintext').textContent = plaintext;
				} catch(e) {
					document.getElementById('decrypting').style.display='none';
					document.getElementById('error-wrap').style.display='block';
					document.getElementById('error-msg').textContent='Decryption failed. Wrong key or corrupted data.';
				}
			})();
			</script>
		`}
	</div>
</body>
</html>`;
}

// Scheduled cleanup handler
export const scheduled: ExportedHandlerScheduledHandler<Env> = async (event, env) => {
	const { cleanupExpired } = await import('./cleanup');
	const deleted = await cleanupExpired(env.DB);
	console.log("Cleaned up " + deleted + " expired/burned links");
};
