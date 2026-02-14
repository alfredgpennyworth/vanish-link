import { corsHeaders } from './cors';
import { createLink, getLink, burnLink, deleteLink } from './db';
import { generateId } from './crypto';

export interface Env { DB: D1Database; }

function json(data: any, status = 200) {
	return new Response(JSON.stringify(data), {
		status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
	});
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;
		const method = request.method;

		if (method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

		// Create
		if (path === '/api/v1/links' && method === 'POST') {
			const body = await request.json() as any;
			const ciphertext = body.ciphertext || body.content;
			if (!ciphertext) return json({ error: 'ciphertext required' }, 400);

			const id = generateId();
			const views = body.views || 1;
			const ttl = body.ttl_seconds || 3600;

			await createLink(env.DB, {
				id, content: ciphertext, views_remaining: views, views_total: views,
				ttl_seconds: ttl, password: null, password_protected: !!body.password_protected,
			});

			return json({ id, views_left: views, expires_in: ttl, e2e: true, password_protected: !!body.password_protected });
		}

		// Consume
		if (path.match(/^\/api\/v1\/links\/[\w-]+\/consume$/) && method === 'POST') {
			const id = path.split('/')[4];
			const link = await getLink(env.DB, id);
			if (!link) return json({ error: 'not found or already burned' }, 404);

			const now = Date.now();
			const created = new Date(link.created_at).getTime();
			if (now > created + link.ttl_seconds * 1000 || link.views_remaining <= 0) {
				await burnLink(env.DB, id);
				return json({ error: 'expired or burned' }, 410);
			}

			await burnLink(env.DB, id);
			return json({
				ciphertext: link.content,
				views_remaining: link.views_remaining - 1,
				burned: link.views_remaining - 1 <= 0,
				password_protected: !!link.password_protected,
			});
		}

		// Status
		if (path.match(/^\/api\/v1\/links\/[\w-]+$/) && method === 'GET') {
			const id = path.split('/').pop()!;
			const link = await getLink(env.DB, id);
			if (!link) return json({ error: 'not found' }, 404);
			return json({
				id: link.id, views_remaining: link.views_remaining, views_total: link.views_total,
				created_at: link.created_at, password_protected: !!link.password_protected,
				expires_at: new Date(new Date(link.created_at).getTime() + link.ttl_seconds * 1000).toISOString(),
			});
		}

		// Delete
		if (path.match(/^\/api\/v1\/links\/[\w-]+$/) && method === 'DELETE') {
			const id = path.split('/').pop()!;
			await deleteLink(env.DB, id);
			return json({ success: true });
		}

		return json({ error: 'not found' }, 404);
	}
};

export const scheduled: ExportedHandlerScheduledHandler<Env> = async (event, env) => {
	const { cleanupExpired } = await import('./cleanup');
	const deleted = await cleanupExpired(env.DB);
	console.log("Cleaned up " + deleted + " expired/burned links");
};
