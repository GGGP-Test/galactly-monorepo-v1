(() => {
  // Bump this when you deploy to force phones to fetch fresh assets.
  const VERSION = "2025-10-20a";

  // Use a wider breakpoint so phones & tablets all use the mobile stacks.
  const BP = 1024;         // <= applies to iPads, large Androids, foldables

  // Shared mobile spacing + safety fixes for Step 0..N
  const css = `
    @media (max-width:${BP}px){
      html, body { overflow-x:hidden; }
      /* Make each process canvas participate in normal flow */
      #section-process .process-canvas,
      #section-process [data-process-step],
      #section-process .scene,
      #section-process .p1m-wrap,
      #section-process .p2m-wrap{
        position:relative !important;
        inset:auto !important;
        display:block !important;
      }

      /* Give steps vertical breathing room so Step 0/1/2 don't collide */
      #section-process .p1m-wrap,
      #section-process .p2m-wrap{
        max-width:520px;
        margin: 40px auto 72px;     /* top / bottom spacing between steps */
        padding: 0 16px;            /* keep your side padding */
        scroll-margin-top: 96px;    /* anchors don't hide under sticky nav */
        z-index: 0;                 /* avoids odd stacking under headers */
      }

      /* Tweak the mobile diamond/circle text fit on all devices */
      #section-process .p1m-diamond > span,
      #section-process .p2m-circle{
        max-width: 88%;
        margin: 0 auto;
        word-break: break-word;
      }
    }
  `;

  const style = document.createElement("style");
  style.id = "process-mobile-global-style";
  style.textContent = css;
  document.head.appendChild(style);

  // Handy: call window.forceProcessReload() from console to hard-refresh with a cache buster.
  window.forceProcessReload = function(){
    const url = new URL(location.href);
    url.searchParams.set("v", VERSION + "-" + Date.now());
    location.replace(url.toString());
  };

  // Optional: widen per-step breakpoints at runtime without editing each file.
  window.PROCESS_CONFIG = window.PROCESS_CONFIG || {};
  ["step1","step2"].forEach(k=>{
    (window.PROCESS_CONFIG[k] = window.PROCESS_CONFIG[k] || {}).MOBILE_BREAKPOINT = BP;
  });
})();