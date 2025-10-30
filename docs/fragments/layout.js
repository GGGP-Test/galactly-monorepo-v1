<!-- fragments/layout.js -->
<script>
(()=> {
  const root = document.currentScript?.dataset?.root || ''; // allow overriding path
  const SLOT_ID = 'site-footer';

  async function inject(id, url){
    const slot = document.getElementById(id);
    if(!slot) return;
    try{
      const res = await fetch(url, {credentials:'same-origin'});
      if(!res.ok) throw new Error(res.status);
      slot.insertAdjacentHTML('beforeend', await res.text());
    }catch(e){
      // graceful fallback
      slot.innerHTML = `<div style="padding:24px 16px;color:#9fb3c7;font:12px/1.4 Inter,system-ui;border-top:1px solid rgba(255,255,255,.06)">
        © 2025 Galactly</div>`;
      console.warn('Footer load failed:', e);
    }
  }

  // Kickoff
  inject(SLOT_ID, `${root}footer.html`);
})();
</script>