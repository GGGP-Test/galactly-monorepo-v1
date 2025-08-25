// Central place to point the frontend at your backend API.
// Uses localStorage override so you can change it without code edits.
(() => {
const DEF = (localStorage.getItem('apiBase') ||
'https://p01--animated-cellar--vz4ftkwrzdfs.code.run').replace(/\/$/, '');
window.API_BASE = DEF;
window.setApiBase = (url) => {
if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
url = url.replace(/\/$/, '');
localStorage.setItem('apiBase', url);
window.API_BASE = url;
console.log('[api-base] API_BASE ->', url);
};
})();
