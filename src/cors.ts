const ALLOWED_ORIGINS = [
	'https://vanish.link',
	'https://vanish-link.pages.dev',
	'http://localhost:3000',
	'http://localhost:8788',
];

export function getCorsHeaders(request?: Request): Record<string, string> {
	const origin = request?.headers.get('Origin') || '';
	const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
	return {
		'Access-Control-Allow-Origin': allowed,
		'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization',
	};
}

// Keep backward compat — wildcard for now during dev, tighten later
export const corsHeaders: Record<string, string> = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
