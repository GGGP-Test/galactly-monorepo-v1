/* docs/fragments/layout.js */
(() => {
  // Find the script element reliably (Safari/iOS safe)
  const scripts = document.getElementsByTagName('script');
  const me = document.currentScript || scripts[scripts.length - 1];

  // Base URL for fragments (from data-root or the script's folder)
  const baseURL = new URL(me?.getAttribute('data-root') || './', me?.src || location.href);

  async function inject(targetId, file) {
    const mount = document.getElementById(targetId);
    if (!mount) return;
    const url = new URL(file, baseURL).toString();
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      mount.innerHTML = await res.text();

      // niceties
      const y = mount.querySelector('[data-year]');
      if (y) y.textContent = new Date().getFullYear();

      const here = new URL(location.href);
      here.hash = ''; here.search = '';
      mount.querySelectorAll('a[data-nav]').forEach(a => {
        const p = new URL(a.getAttribute('href'), location.href);
        p.hash = ''; p.search = '';
        if (p.pathname.replace(/\/+$/, '') === here.pathname.replace(/\/+$/, '')) {
          a.classList.add('is-active');
        }
      });
    } catch (err) {
      console.error('[fragments] failed:', url, err);
      mount.innerHTML = `<!-- failed to load ${url} -->`;
    }
  }

  // Inject footer (add more later if you want)
  inject('site-footer', 'footer.html');
})();