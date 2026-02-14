CREATE TABLE links (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    views_remaining INTEGER NOT NULL DEFAULT 1,
    views_total INTEGER NOT NULL DEFAULT 1,
    ttl_seconds INTEGER NOT NULL DEFAULT 3600,
    password TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_links_created ON links(created_at);
