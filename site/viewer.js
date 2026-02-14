/**
 * Vanish.link — Viewer page logic
 * Fetches ciphertext from API, decrypts locally using key from URL fragment.
 */
(async () => {
	const path = window.location.pathname;
	const id = path.replace('/v/', '');
	const key = window.location.hash.slice(1);

	if (!id) {
		showError('Invalid link.');
		return;
	}

	if (!key) {
		showError('Missing decryption key. The link may be incomplete — the #key portion is required.');
		return;
	}

	try {
		const res = await fetch(VANISH_API + '/api/v1/links/' + id + '/consume', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '{}',
		});

		if (res.status === 404 || res.status === 410) {
			showBurned();
			return;
		}

		if (!res.ok) {
			showError('Failed to retrieve link. It may have expired.');
			return;
		}

		const data = await res.json();
		const plaintext = await vanishDecrypt(data.ciphertext, key);

		document.getElementById('decrypting').style.display = 'none';
		document.getElementById('content-wrap').style.display = 'block';
		document.getElementById('plaintext').textContent = plaintext;
		document.getElementById('views-info').textContent =
			'⚠️ This content has been burned. Views remaining: ' + data.views_remaining;
	} catch (e) {
		showError('Decryption failed. Wrong key or corrupted data.');
	}
})();

function showBurned() {
	document.getElementById('decrypting').style.display = 'none';
	document.getElementById('burned-wrap').style.display = 'block';
}

function showError(msg) {
	document.getElementById('decrypting').style.display = 'none';
	document.getElementById('error-wrap').style.display = 'block';
	document.getElementById('error-msg').textContent = msg;
}
