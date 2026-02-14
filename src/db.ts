export interface Link {
	id: string;
	content: string;
	views_remaining: number;
	views_total: number;
	ttl_seconds: number;
	password: string | null;
	password_protected: number;
	created_at: string;
}

interface CreateLinkParams {
	id: string;
	content: string;
	views_remaining: number;
	views_total: number;
	ttl_seconds: number;
	password: string | null;
	password_protected?: boolean;
}

export async function createLink(db: D1Database, params: CreateLinkParams): Promise<void> {
	await db.prepare(
		'INSERT INTO links (id, content, views_remaining, views_total, ttl_seconds, password, password_protected) VALUES (?, ?, ?, ?, ?, ?, ?)'
	).bind(
		params.id, params.content, params.views_remaining, params.views_total,
		params.ttl_seconds, params.password, params.password_protected ? 1 : 0
	).run();
}

export async function getLink(db: D1Database, id: string): Promise<Link | null> {
	return await db.prepare('SELECT * FROM links WHERE id = ?').bind(id).first<Link>();
}

export async function burnLink(db: D1Database, id: string): Promise<void> {
	await db.prepare('UPDATE links SET views_remaining = views_remaining - 1 WHERE id = ?').bind(id).run();
}

export async function deleteLink(db: D1Database, id: string): Promise<void> {
	await db.prepare('DELETE FROM links WHERE id = ?').bind(id).run();
}
