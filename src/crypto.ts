/**
 * Server-side utilities (ID generation only)
 * All encryption/decryption is now client-side (E2E)
 */

const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function generateId(length: number = 12): string {
	const array = new Uint8Array(length);
	crypto.getRandomValues(array);
	return Array.from(array, b => CHARS[b % CHARS.length]).join('');
}
