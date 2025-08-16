// 🔧 EDIT ME: Set this to your Render backend URL
window.API_BASE = window.API_BASE || 'https://galactly-monorepo-v1.onrender.com';

// Patch global fetch: if request starts with /api/v1, rewrite to backend
const _fetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url && url.startsWith('/api/v1')) {
    const full = window.API_BASE + url;
    return _fetch(full, init);
  }
  return _fetch(input, init);
};
