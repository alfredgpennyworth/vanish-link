/**
 * Vanish.link — Viewer page logic
 * Fetches ciphertext from API, decrypts locally using key from URL fragment.
 * If password-protected, prompts for password before decryption.
 */
(async () => {
	const path = window.location.pathname;
	const id = path.replace('/v/', '');
	const key = window.location.hash.slice(1);

	if (!id) return showError('Invalid link.');
	if (!key) return showError('Missing decryption key. The link may be incomplete.');

	try {
		const res = await fetch(VANISH_API + '/api/v1/links/' + id + '/consume', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '{}',
		});

		if (res.status === 404 || res.status === 410) return showBurned();
		if (!res.ok) return showError('Failed to retrieve link.');

		const data = await res.json();

		if (data.password_protected) {
			showPasswordPrompt(data, key);
		} else {
			const plaintext = await vanishDecrypt(data.ciphertext, key, null);
			showContent(plaintext, data.views_remaining);
		}
	} catch (e) {
		showError('Decryption failed. Wrong key or corrupted data.');
	}
})();

function showPasswordPrompt(data, key) {
	document.getElementById('decrypting').style.display = 'none';
	document.getElementById('password-wrap').style.display = 'block';

	document.getElementById('pw-submit').addEventListener('click', async () => {
		const pw = document.getElementById('pw-input').value;
		const errEl = document.getElementById('pw-error');
		errEl.style.display = 'none';

		if (!pw) return;

		try {
			const plaintext = await vanishDecrypt(data.ciphertext, key, pw);
			document.getElementById('password-wrap').style.display = 'none';
			showContent(plaintext, data.views_remaining);
		} catch (e) {
			errEl.textContent = 'Wrong password. Try again.';
			errEl.style.display = 'block';
		}
	});

	document.getElementById('pw-input').addEventListener('keydown', (e) => {
		if (e.key === 'Enter') document.getElementById('pw-submit').click();
	});
}

function showContent(plaintext, viewsRemaining) {
	document.getElementById('decrypting').style.display = 'none';
	document.getElementById('content-wrap').style.display = 'block';
	document.getElementById('plaintext').textContent = plaintext;
	document.getElementById('views-info').textContent =
		'\u26A0\uFE0F This content has been burned. Views remaining: ' + viewsRemaining;
}

function showBurned() {
	document.getElementById('decrypting').style.display = 'none';
	document.getElementById('burned-wrap').style.display = 'block';
}

function showError(msg) {
	document.getElementById('decrypting').style.display = 'none';
	document.getElementById('error-wrap').style.display = 'block';
	document.getElementById('error-msg').textContent = msg;
}
