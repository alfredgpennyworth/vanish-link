/**
 * Database operations for Vanish.link
 */

export interface Link {
	id: string;
	content: string;
	views_remaining: number;
	views_total: number;
	ttl_seconds: number;
	password: string | null;
	created_at: string;
}

export interface CreateLinkParams {
	id: string;
	content: string;
	views_remaining: number;
	views_total: number;
	ttl_seconds: number;
	password: string | null;
}

export async function createLink(db: D1Database, params: CreateLinkParams): Promise<void> {
	await db.prepare(`
		INSERT INTO links (id, content, views_remaining, views_total, ttl_seconds, password, created_at)
		VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
	`).bind(
		params.id,
		params.content,
		params.views_remaining,
		params.views_total,
		params.ttl_seconds,
		params.password
	).run();
}

export async function getLink(db: D1Database, id: string): Promise<Link | null> {
	const result = await db.prepare(`
		SELECT id, content, views_remaining, views_total, ttl_seconds, password, created_at
		FROM links WHERE id = ?
	`).bind(id).first<Link>();
	
	return result || null;
}

export async function burnLink(db: D1Database, id: string): Promise<void> {
	await db.prepare(`
		UPDATE links SET views_remaining = views_remaining - 1 WHERE id = ?
	`).bind(id).run();
}

export async function deleteLink(db: D1Database, id: string): Promise<void> {
	await db.prepare(`DELETE FROM links WHERE id = ?`).bind(id).run();
}
