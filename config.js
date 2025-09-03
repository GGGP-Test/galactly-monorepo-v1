/* docs/config.js — runtime config (no console needed) */
(function () {
  // IMPORTANT: host-only base (NO /api/v1 here)
  var HOST_BASE = 'https://p01--animated-cellar--vz4ftkwrzdfs.code.run';
  var DEV_UNLIMITED = true; // UI-side dev flag (keep true while testing)

  // Export for any page scripts that use API_DEFAULT
  window.API_DEFAULT = HOST_BASE;
  window.DEV_UNLIMITED = DEV_UNLIMITED;

  try {
    // Persist for any fetch wrapper that reads from localStorage
    localStorage.setItem('apiBase', HOST_BASE);
    if (DEV_UNLIMITED) localStorage.setItem('gal_unlim','true');
  } catch (e) {}

  console.log('[config] api host =', HOST_BASE, 'unlim =', DEV_UNLIMITED);
})();
