/**
 * Vanish.link — Client-side E2E encryption
 * AES-256-GCM via Web Crypto API
 * Optional password layer: PBKDF2-derived key wraps content before the random key.
 * This file is served statically and can be audited against the source repo.
 */
const VANISH_API = 'https://api.vanish.link';

// --- Core AES-256-GCM ---

async function aesEncrypt(plainBytes, cryptoKey) {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, plainBytes);
	const out = new Uint8Array(iv.length + new Uint8Array(ct).length);
	out.set(iv);
	out.set(new Uint8Array(ct), iv.length);
	return out;
}

async function aesDecrypt(data, cryptoKey) {
	const iv = data.slice(0, 12);
	const ct = data.slice(12);
	return await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ct);
}

// --- Password key derivation ---

async function deriveKey(password, salt) {
	const keyMaterial = await crypto.subtle.importKey(
		'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
	);
	return crypto.subtle.deriveKey(
		{ name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
		keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
	);
}

// --- Encrypt ---

async function vanishEncrypt(plaintext, password) {
	let data = new TextEncoder().encode(plaintext);

	// Layer 1: password (if provided)
	let salt = null;
	if (password) {
		salt = crypto.getRandomValues(new Uint8Array(16));
		const pwKey = await deriveKey(password, salt);
		data = await aesEncrypt(data, pwKey);
	}

	// Layer 2: random key (always)
	const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
	const encrypted = await aesEncrypt(data, key);

	const rawKey = await crypto.subtle.exportKey('raw', key);

	// If password was used, prepend salt to ciphertext
	let finalCt;
	if (salt) {
		finalCt = new Uint8Array(salt.length + encrypted.length);
		finalCt.set(salt);
		finalCt.set(encrypted, salt.length);
	} else {
		finalCt = encrypted;
	}

	return {
		ciphertext: btoa(String.fromCharCode(...finalCt)),
		key: btoa(String.fromCharCode(...new Uint8Array(rawKey))),
	};
}

// --- Decrypt ---

async function vanishDecrypt(ciphertextB64, keyB64, password) {
	const rawKey = Uint8Array.from(atob(keyB64), c => c.charCodeAt(0));
	const cryptoKey = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);

	let data = Uint8Array.from(atob(ciphertextB64), c => c.charCodeAt(0));

	// Layer 2: random key (always first to unwrap)
	if (password) {
		// Salt is first 16 bytes
		const salt = data.slice(0, 16);
		const encrypted = data.slice(16);
		const unwrapped = new Uint8Array(await aesDecrypt(encrypted, cryptoKey));

		// Layer 1: password
		const pwKey = await deriveKey(password, salt);
		const plainBytes = await aesDecrypt(unwrapped, pwKey);
		return new TextDecoder().decode(plainBytes);
	} else {
		const plainBytes = await aesDecrypt(data, cryptoKey);
		return new TextDecoder().decode(plainBytes);
	}
}
