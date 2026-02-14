/**
 * Vanish.link API — Zero-knowledge self-destructing links
 * API only — no HTML. Static viewer lives on a separate origin (Cloudflare Pages).
 */

import { corsHeaders } from './cors';
import { createLink, getLink, burnLink, deleteLink } from './db';
import { generateId } from './crypto';

export interface Env {
	DB: D1Database;
}

function jsonResponse(data: any, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { ...corsHeaders, 'Content-Type': 'application/json' },
	});
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;
		const method = request.method;

		if (method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		// Create link
		if (path === '/api/v1/links' && method === 'POST') {
			const body = await request.json() as {
				ciphertext?: string;
				content?: string;
				views?: number;
				ttl_seconds?: number;
			};

			const ciphertext = body.ciphertext || body.content;
			if (!ciphertext) return jsonResponse({ error: 'ciphertext required' }, 400);

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

			return jsonResponse({ id, views_left: views, expires_in: ttl, e2e: !!body.ciphertext });
		}

		// Consume link
		if (path.match(/^\/api\/v1\/links\/[\w-]+\/consume$/) && method === 'POST') {
			const id = path.split('/')[4];
			const link = await getLink(env.DB, id);

			if (!link) return jsonResponse({ error: 'not found or already burned' }, 404);

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
			if (!link) return jsonResponse({ error: 'not found' }, 404);

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

		return jsonResponse({ error: 'not found' }, 404);
	}
};

// Scheduled cleanup
export const scheduled: ExportedHandlerScheduledHandler<Env> = async (event, env) => {
	const { cleanupExpired } = await import('./cleanup');
	const deleted = await cleanupExpired(env.DB);
	console.log("Cleaned up " + deleted + " expired/burned links");
};
