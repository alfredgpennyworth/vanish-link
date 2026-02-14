/**
 * Scheduled cleanup of expired links
 */
export async function cleanupExpired(db: D1Database): Promise<number> {
  const result = await db.prepare(`
    DELETE FROM links 
    WHERE datetime(created_at, '+' || ttl_seconds || ' seconds') < datetime('now')
    OR views_remaining <= 0
  `).run();
  return result.meta.changes || 0;
}
