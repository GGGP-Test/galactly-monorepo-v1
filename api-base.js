// Set this once (or use the input in free-panel.html). It rewrites relative /api calls
// and attaches a stable x-galactly-user header for presence & priority scoring.
window.API_BASE = window.API_BASE || "https://p01--animated-cellar--vz4ftkwrzdfs.code.run"; // <-- your Render URL
(function(){
const uidKey = 'galactly_uid';
let uid = localStorage.getItem(uidKey);
if(!uid){ uid = 'u-' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(uidKey, uid); }
const _fetch = window.fetch.bind(window);
window.fetch = (input, init={}) => {
const url = typeof input === 'string' ? input : input.url;
if(url && url.startsWith('/api/')){
const full = window.API_BASE.replace(/\/+$/,'') + url;
init.headers = Object.assign({}, init.headers, {'x-galactly-user': uid});
return _fetch(full, init);
}
return _fetch(input, init);
};
})();
