/**
 * Vanish.link - Self-destructing links for agents
 */

import { corsHeaders } from './cors';
import { createLink, getLink, burnLink, deleteLink } from './db';
import { generateId, encrypt, decrypt } from './crypto';

export interface Env {
	DB: D1Database;
	ENCRYPTION_KEY: string;
}

const html = (body: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Vanish.link</title>
	<style>
		* { box-sizing: border-box; margin: 0; padding: 0; }
		body { 
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			background: #0a0a0a; 
			color: #fff;
			min-height: 100vh;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 20px;
		}
		.container { 
			max-width: 600px; 
			width: 100%;
			text-align: center;
		}
		.logo { 
			font-size: 3rem; 
			margin-bottom: 1rem;
			filter: drop-shadow(0 0 20px rgba(239,68,68,0.5));
		}
		h1 { 
			font-size: 1.5rem; 
			margin-bottom: 1rem;
			color: #ef4444;
		}
		.content {
			background: #1a1a1a;
			border: 1px solid #333;
			border-radius: 12px;
			padding: 1.5rem;
			margin: 1.5rem 0;
			text-align: left;
			overflow-x: auto;
		}
		.content pre {
			white-space: pre-wrap;
			word-break: break-all;
			font-size: 0.9rem;
			line-height: 1.5;
		}
		.warning {
			color: #f59e0b;
			font-size: 0.875rem;
			margin-bottom: 1rem;
		}
		.btn {
			background: #ef4444;
			color: white;
			border: none;
			padding: 0.75rem 1.5rem;
			border-radius: 8px;
			cursor: pointer;
			font-size: 1rem;
			margin: 0.5rem;
		}
		.btn:hover { background: #dc2626; }
		.burned {
			color: #ef4444;
			font-size: 1.25rem;
		}
		.stats {
			color: #666;
			font-size: 0.875rem;
			margin-top: 1rem;
		}
		.agent-code {
			background: #111;
			border: 1px solid #333;
			border-radius: 8px;
			padding: 1rem;
			margin: 1rem 0;
			text-align: left;
		}
		.agent-code code {
			color: #10b981;
			font-family: 'Monaco', 'Menlo', monospace;
			font-size: 0.85rem;
		}
	</style>
</head>
<body>
	<div class="container">
		<div class="logo">🔥</div>
		<h1>vanish.link</h1>
		${body}
	</div>
</body>
</html>
`;

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

			if (path === '/' || path === '/index.html') {
				return new Response(html(`
					<p>Self-destructing links for agents and humans.</p>
					<div class="agent-code">
						<code>curl -X POST https://vanish.link/api/v1/links \\
  -H "Content-Type: application/json" \\
  -d '{"content": "secret", "views": 1, "ttl_seconds": 3600}'</code>
					</div>
				`), {
					headers: { 'Content-Type': 'text/html' }
				});
			}

			const id = path.replace('/', '');
			if (id) {
				return handleLinkView(request, env, id);
			}

			return new Response('Not Found', { status: 404 });
		} catch (err) {
			return new Response('Error: ' + err, { status: 500 });
		}
	}
};

async function handleApi(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname;
	const method = request.method;

	if (path === '/api/v1/links' && method === 'POST') {
		const body = await request.json() as { content: string; views?: number; ttl_seconds?: number; password?: string };
		
		if (!body.content) {
			return new Response(JSON.stringify({ error: 'content required' }), { 
				status: 400, 
				headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
			});
		}

		const views = body.views || 1;
		const ttl = body.ttl_seconds || 3600;
		const password = body.password;
		
		const id = generateId();
		const encrypted = await encrypt(body.content, env.ENCRYPTION_KEY);
		
		await createLink(env.DB, {
			id,
			content: encrypted,
			views_remaining: views,
			ttl_seconds: ttl,
			password: password ? await encrypt(password, env.ENCRYPTION_KEY) : null,
			views_total: views
		});

		return new Response(JSON.stringify({
			id,
			url: `https://vanish.link/${id}`,
			views_left: views,
			expires_in: ttl
		}), { 
			headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
		});
	}

	if (path.match(/^\/api\/v1\/links\/[\w-]+$/) && method === 'GET') {
		const id = path.split('/').pop()!;
		const link = await getLink(env.DB, id);
		
		if (!link) {
			return new Response(JSON.stringify({ error: 'not found' }), { 
				status: 404, 
				headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
			});
		}

		return new Response(JSON.stringify({
			id: link.id,
			views_remaining: link.views_remaining,
			views_total: link.views_total,
			created_at: link.created_at,
			expires_at: new Date(Date.now() + link.ttl_seconds * 1000).toISOString()
		}), { 
			headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
		});
	}

	if (path.match(/^\/api\/v1\/links\/[\w-]+$/) && method === 'DELETE') {
		const id = path.split('/').pop()!;
		await deleteLink(env.DB, id);
		
		return new Response(JSON.stringify({ success: true }), { 
			headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
		});
	}


	// Consume a link (agent-friendly: returns raw content)
	if (path.match(/^\/api\/v1\/links\/[\w-]+\/consume$/) && method === 'POST') {
		const id = path.split('/')[4];
		const body = await request.json().catch(() => ({})) as { password?: string };
		const link = await getLink(env.DB, id);

		if (!link) {
			return new Response(JSON.stringify({ error: 'not found or already burned' }), {
				status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
			});
		}

		const now = Date.now();
		const created = new Date(link.created_at).getTime();
		if (now > created + link.ttl_seconds * 1000 || link.views_remaining <= 0) {
			await burnLink(env.DB, id);
			return new Response(JSON.stringify({ error: 'expired or burned' }), {
				status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
			});
		}

		if (link.password) {
			const correct = await decrypt(link.password, env.ENCRYPTION_KEY);
			if (body.password !== correct) {
				return new Response(JSON.stringify({ error: 'password required' }), {
					status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
				});
			}
		}

		const decrypted = await decrypt(link.content, env.ENCRYPTION_KEY);
		await burnLink(env.DB, id);

		return new Response(JSON.stringify({
			content: decrypted,
			views_remaining: link.views_remaining - 1,
			burned: link.views_remaining - 1 <= 0
		}), {
			headers: { ...corsHeaders, 'Content-Type': 'application/json' }
		});
	}

	return new Response('Not Found', { status: 404 });
}

async function handleLinkView(request: Request, env: Env, id: string): Promise<Response> {
	const link = await getLink(env.DB, id);
	const url = new URL(request.url);
	
	if (!link) {
		return new Response(html('<p class="burned">This link never existed or has already vanished.</p>'), {
			headers: { 'Content-Type': 'text/html' }
		});
	}

	const now = Date.now();
	const created = new Date(link.created_at).getTime();
	if (now > created + link.ttl_seconds * 1000) {
		await burnLink(env.DB, id);
		return new Response(html('<p class="burned">This link has expired.</p>'), {
			headers: { 'Content-Type': 'text/html' }
		});
	}

	if (link.views_remaining <= 0) {
		return new Response(html('<p class="burned">This link has already been viewed and vanished.</p>'), {
			headers: { 'Content-Type': 'text/html' }
		});
	}

	if (link.password) {
		const provided = url.searchParams.get('password');
		const correct = await decrypt(link.password, env.ENCRYPTION_KEY);
		
		if (provided !== correct) {
			return new Response(html(`
				<p>This link is password protected.</p>
				<form method="get">
					<input type="password" name="password" placeholder="Enter password" 
						style="padding:0.75rem;border-radius:8px;border:1px solid #333;background:#111;color:#fff;width:250px;">
					<button type="submit" class="btn">Unlock</button>
				</form>
			`), { headers: { 'Content-Type': 'text/html' } });
		}
	}

	const content = await decrypt(link.content, env.ENCRYPTION_KEY);
	await burnLink(env.DB, id);

	const isRaw = url.pathname.endsWith('/raw');

	return new Response(isRaw ? content : html(`
		<p class="warning">⚠️ This link has been burned. It can only be viewed once.</p>
		<div class="content"><pre>${escapeHtml(content)}</pre></div>
		<p class="stats">Views remaining: 0</p>
	`), {
		headers: { 'Content-Type': isRaw ? 'text/plain' : 'text/html' }
	});
}

function escapeHtml(str: string): string {
	return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Scheduled cleanup handler
export const scheduled: ExportedHandlerScheduledHandler<Env> = async (event, env) => {
	const { cleanupExpired } = await import('./cleanup');
	const deleted = await cleanupExpired(env.DB);
	console.log(`Cleaned up ${deleted} expired/burned links`);
};
