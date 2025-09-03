/* Galactly runtime config injected from repo (no console needed) */
(function () {
  var API = 'https://p01--animated-cellar--vz4ftkwrzdfs.code.run/api/v1';
  var UNLIM = true; // set to false before going live

  // Expose for our fetch wrapper
  window.API_DEFAULT = API;
  window.DEV_UNLIMITED = UNLIM;

  try {
    localStorage.setItem('apiBase', API);
    if (UNLIM) localStorage.setItem('gal_unlim','true');
  } catch (e) {}

  console.log('[config] api =', API, 'unlim =', UNLIM);
})();
