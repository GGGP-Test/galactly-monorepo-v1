(function () {
  var HOST_BASE = 'https://p01--animated-cellar--vz4ftkwrzdfs.code.run'; // host ONLY (no /api/v1)
  var DEV_UNLIMITED = true;

  window.API_DEFAULT = HOST_BASE;
  window.DEV_UNLIMITED = DEV_UNLIMITED;

  try {
    localStorage.setItem('apiBase', HOST_BASE);
    if (DEV_UNLIMITED) localStorage.setItem('gal_unlim','true');
  } catch (e) {}

  console.log('[config] api host =', HOST_BASE, 'unlim =', DEV_UNLIMITED);
})();
