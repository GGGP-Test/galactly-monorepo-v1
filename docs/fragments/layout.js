/* fragments/layout.js */
(() => {
  // Figure out where the fragments live.
  // 1) If you pass data-root on the script tag, we use that.
  // 2) Else we use the folder this JS was loaded from.
  const me = document.currentScript || document.querySelector('script[src*="layout.js"]');
  const baseURL = new URL(me?.getAttribute('data-root') || './', me?.src || location.href);

  async function inject(targetId, file) {
    const host = document.getElementById(targetId);
    if (!host) return;
    const url = new URL(file, baseURL).toString();
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      host.innerHTML = await res.text();

      // Small niceties: current year + mark active link
      const y = host.querySelector('[data-year]');
      if (y) y.textContent = new Date().getFullYear();
      const here = location.pathname.replace(/\/+$/, '');
      host.querySelectorAll('a[data-nav]').forEach(a => {
        const p = new URL(a.getAttribute('href'), location.href).pathname.replace(/\/+$/, '');
        if (p && p === here) a.classList.add('is-active');
      });
    } catch (err) {
      console.error('[fragments]', 'failed', url, err);
      host.innerHTML = `<!-- failed to load ${url} -->`;
    }
  }

  // Add more fragments later if you want (header, etc.)
  inject('site-footer', 'footer.html');
})();