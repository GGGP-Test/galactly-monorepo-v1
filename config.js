/* docs/config.js — host-only API base + dev flag */
(function () {
  // IMPORTANT: host-only (NO /api/v1 here)
  var HOST_BASE = 'https://p01--animated-cellar--vz4ftkwrzdfs.code.run';
  var DEV_UNLIMITED = true;

  window.API_DEFAULT = HOST_BASE;
  window.DEV_UNLIMITED = DEV_UNLIMITED;

  try {
    localStorage.setItem('apiBase', HOST_BASE);
    if (DEV_UNLIMITED) localStorage.setItem('gal_unlim','true');
  } catch (e) {}

  console.log('[config] api host =', HOST_BASE, 'unlim =', DEV_UNLIMITED);
})();
