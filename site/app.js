/**
 * Vanish.link — Create page logic
 */
document.getElementById('create-btn').addEventListener('click', async () => {
	const content = document.getElementById('content').value.trim();
	if (!content) return;

	const views = parseInt(document.getElementById('views').value);
	const ttl = parseInt(document.getElementById('ttl').value);
	const btn = document.getElementById('create-btn');

	btn.disabled = true;
	btn.textContent = 'Encrypting...';

	try {
		const { ciphertext, key } = await vanishEncrypt(content);

		btn.textContent = 'Uploading...';

		const res = await fetch(VANISH_API + '/api/v1/links', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ciphertext, views, ttl_seconds: ttl }),
		});
		const data = await res.json();

		// Build the URL: static site origin + link ID + key in fragment
		const fullUrl = window.location.origin + '/v/' + data.id + '#' + key;
		document.getElementById('url-text').textContent = fullUrl;

		const units = ttl < 60 ? ttl+'s' : ttl < 3600 ? Math.floor(ttl/60)+'m' : ttl < 86400 ? Math.floor(ttl/3600)+'h' : Math.floor(ttl/86400)+'d';
		document.getElementById('meta').textContent =
			'🔒 E2E encrypted · ' + views + ' view' + (views > 1 ? 's' : '') + ' · expires in ' + units;
		document.getElementById('result').style.display = 'block';
		document.getElementById('content').value = '';
	} catch (e) {
		alert('Error: ' + e.message);
	}
	btn.disabled = false;
	btn.textContent = 'Create Vanish Link';
});

document.getElementById('url-box').addEventListener('click', () => {
	const url = document.getElementById('url-text').textContent;
	navigator.clipboard.writeText(url);
	const el = document.getElementById('copied');
	el.style.display = 'inline';
	setTimeout(() => el.style.display = 'none', 2000);
});
