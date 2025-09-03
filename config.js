/* Galactly runtime config injected from repo (no console needed) */
window.API_DEFAULT = 'https://p01--animated-cellar--vz4ftkwrzdfs.code.run/api/v1';
window.DEV_UNLIMITED = false;  // <- set to false before going live

try {
  // Persist for our fetch wrapper
  localStorage.setItem('apiBase', window.API_DEFAULT);
  if (window.DEV_UNLIMITED) localStorage.setItem('gal_unlim','true');
} catch (e) {}

console.log('[config] api =', window.API_DEFAULT, 'unlim =', window.DEV_UNLIMITED);
