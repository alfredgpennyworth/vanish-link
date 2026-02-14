/**
 * Vanish.link — Client-side E2E encryption
 * AES-256-GCM via Web Crypto API
 * This file is served statically and can be audited against the source repo.
 */
const VANISH_API = 'https://api.vanish.link';

async function vanishEncrypt(plaintext) {
	const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encoded = new TextEncoder().encode(plaintext);
	const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

	const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
	combined.set(iv);
	combined.set(new Uint8Array(ciphertext), iv.length);

	const rawKey = await crypto.subtle.exportKey('raw', key);
	return {
		ciphertext: btoa(String.fromCharCode(...combined)),
		key: btoa(String.fromCharCode(...new Uint8Array(rawKey))),
	};
}

async function vanishDecrypt(ciphertextB64, keyB64) {
	const rawKey = Uint8Array.from(atob(keyB64), c => c.charCodeAt(0));
	const cryptoKey = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);

	const data = Uint8Array.from(atob(ciphertextB64), c => c.charCodeAt(0));
	const iv = data.slice(0, 12);
	const encrypted = data.slice(12);

	const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, encrypted);
	return new TextDecoder().decode(decrypted);
}
