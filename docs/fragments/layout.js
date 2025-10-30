// /docs/fragments/layout.js
(()=> {
  const S = document.currentScript;
  const rootRaw = (S?.dataset?.root || 'fragments/').trim();

  // Resolve root relative to the PAGE (location), not the script file
  const base = new URL('.', window.location.href);
  const root = new URL(rootRaw.replace(/^\.\//,''), base);     // e.g. /fragments/

  const urlFor = f => new URL(f, root).href;

  async function inject(sel, file){
    const host = document.querySelector(sel);
    if(!host) return;
    const url = urlFor(file);
    const res = await fetch(url);
    if(!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    host.innerHTML = await res.text();
  }

  inject('#site-footer', 'footer.html')
    .catch(err => console.error('[fragments] failed:', urlFor('footer.html'), err));
})();