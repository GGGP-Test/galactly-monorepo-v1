<script id="api-base-js" type="text/plain">/* save as api-base.js in repo root */
(function(){
const DEF = 'https://p01--animated-cellar--vz4ftkwrzdfs.code.run'; // Render (animated-cellar)
const param = new URLSearchParams(location.search).get('api');
let base = (localStorage.getItem('apiBase')||'').trim() || (param||'').trim() || DEF;
if(!/^https?:\/\//i.test(base)) base = 'https://'+base; base = base.replace(/\/$/,'');
window.API_BASE = base;
const _fetch = window.fetch.bind(window);
window.fetch = (input, init) => {
const url = typeof input === 'string' ? input : input.url;
if (url && /^\/api\/v1\//.test(url)) return _fetch(window.API_BASE + url, init);
return _fetch(input, init);
};
console.log('[api-base] API_BASE =', window.API_BASE);
})();
</script>
