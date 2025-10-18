/* Section 3 – Process (vanilla JS)
   - Starts on step 0 (numbers only)
   - On Next, gently slides board left and reveals Step 1
   - Lamp behaves like a pane without edges (soft light only)
   - Step 1 draws a live neon path from the domain node to the board’s right edge
*/

(() => {
  'use strict';

  // ---- hard guard: if we’ve mounted before, cleanly destroy ----
  if (window.__PROC && typeof window.__PROC.destroy === 'function') {
    window.__PROC.destroy();
  }

  const DATA = window.PROCESS_DATA;
  const host = document.getElementById('section-process');
  if (!host || !DATA) {
    // Fail quietly if container or data is missing
    return;
  }

  // ---- apply theme tokens from PROCESS_DATA.theme to :root of the section ----
  const applyTheme = () => {
    const t = DATA.theme || {};
    const set = (k, v) => v != null && host.style.setProperty(k, String(v));
    set('--p-bg', t.bg);
    set('--p-text', t.text);
    set('--p-muted', t.muted);
    set('--p-stroke', t.stroke);
    set('--p-primary', t.primary);
    set('--p-secondary', t.secondary);
    set('--p-tertiary', t.tertiary);
    set('--p-cable', t.cable);
    set('--p-cable-dim', t.cableDim);
    if (t.glass) {
      set('--glass-fill', t.glass.fill);
      set('--glass-stroke', t.glass.stroke);
      set('--glass-blur', `${t.glass.blurPx || 10}px`);
      set('--glass-hover', t.glass.hoverFill);
      set('--glass-active', t.glass.activeFill);
    }
  };

  // ---- element helpers ----
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };

  // ---- build static shell ----
  host.innerHTML = ''; // clean slate

  const section = el('section', 'proc-section');
  const inner   = el('div', 'proc-inner');
  const wrap    = el('div', 'p-wrap');

  // left dock (numbers 0..5 + CTAs)
  const dock    = el('aside', 'p-dock');
  const stepper = el('div', 'p-stepper');
  const TOTAL_STEPS = 6; // 0..5

  for (let i = 0; i < TOTAL_STEPS; i++) {
    const row  = el('div', 'p-step');
    const dot  = el('div', 'p-dot', String(i));
    const lbl  = el('div', 'p-label', ''); // reserved, kept hidden by CSS
    row.append(dot, lbl);
    stepper.appendChild(row);
  }

  const ctas    = el('div', 'p-ctas');
  const prevBtn = el('button', 'btn-glass', 'Prev step');
  const nextBtn = el('button', 'btn-glass', 'Next step');
  ctas.append(prevBtn, nextBtn);
  dock.append(stepper, ctas);

  // right board (lamp pane + svg cable + stage)
  const board   = el('section', 'p-board');
  const lamp    = el('div');       // soft lamp pane (no borders)
  const svg     = el('svg', 'proc-svg');
  const cable   = el('path', 'proc-cable is-dim');
  const stage   = el('div', 'p-stage');

  // configure svg
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.appendChild(cable);

  // lamp as pane – subtle gradients, no edges
  Object.assign(lamp.style, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
    mixBlendMode: 'screen',
    // soft key-light from the left “seam” + faint fill
    background:
      'radial-gradient(90% 120% at 30% 50%, rgba(127,178,255,.12) 0%, rgba(127,178,255,0) 60%)' +
      ', radial-gradient(70% 90% at 40% 48%, rgba(230,195,107,.08) 0%, rgba(230,195,107,0) 55%)'
  });

  board.append(svg, stage, lamp);
  wrap.append(dock, board);
  inner.appendChild(wrap);
  section.appendChild(inner);
  host.appendChild(section);

  applyTheme();

  // ---- state + utilities ----
  let current = 0;                 // force step 0 on load
  const rows = Array.from(stepper.querySelectorAll('.p-step'));

  const setButtons = () => {
    prevBtn.disabled = current <= 0;
    nextBtn.disabled = current >= TOTAL_STEPS - 1;
  };

  const markStepper = () => {
    rows.forEach((r, idx) => {
      r.classList.toggle('is-current', idx === current);
      r.classList.toggle('is-done', idx < current);
    });
  };

  const clearStage = () => {
    stage.innerHTML = '';
    // hide cable until we need it
    cable.setAttribute('d', '');
    cable.classList.add('is-dim');
  };

  // Live path computation from a DOM node to the board’s right edge
  let activeNode = null;
  const drawCableFromNode = () => {
    if (!activeNode) return;
    const bb = board.getBoundingClientRect();
    const rb = activeNode.getBoundingClientRect();

    const startX = rb.right  - bb.left;                  // right edge of node
    const startY = rb.top + (rb.height * 0.66) - bb.top; // a touch below mid
    const endX   = bb.width - 20;                        // near board edge
    const endY   = startY + 8;

    // cubic bezier control points for a gentle rightward arc
    const c1x = startX + Math.max(60, bb.width * 0.10);
    const c2x = startX + Math.max(140, bb.width * 0.28);

    const d = `M ${startX} ${startY} C ${c1x} ${startY}, ${c2x} ${endY}, ${endX} ${endY}`;
    cable.setAttribute('d', d);
    cable.classList.remove('is-dim');
  };

  const onResize = (() => {
    let ticking = false;
    return () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        drawCableFromNode();
        ticking = false;
      });
    };
  })();
  window.addEventListener('resize', onResize);

  // ---- renderers ----
  const renderStep0 = () => {
    clearStage();
    // small hint glow only; no content
    stage.style.transition = 'none';
    stage.style.opacity = '1';
  };

  const renderStep1 = () => {
    clearStage();

    // subtle entrance
    stage.style.opacity = '0';
    stage.style.transform = 'translateX(10px)';
    stage.style.transition = 'opacity .35s ease, transform .35s ease';

    // left copy block (constrained, away from lamp seam)
    const copy = el('div', '');
    Object.assign(copy.style, {
      position: 'absolute',
      left: '24px',
      top: '28px',
      maxWidth: '360px',
      lineHeight: '1.35'
    });
    copy.innerHTML = `
      <h3 style="margin:0 0 8px; font: 800 22px/1.1 'Newsreader', Georgia, serif;">
        We start with your company.
      </h3>
      <p style="margin:0; color: var(--p-muted); font-size:14px;">
        We read your company and data to learn what matters. Then our system builds
        simple metrics around your strengths. With that map in hand, we move forward
        to find real buyers who match your persona.
      </p>
    `;

    // glowing domain node on the right (stroke-only feel)
    const node = el('div', '');
    Object.assign(node.style, {
      position: 'absolute',
      right: '60px',
      top: '78px',
      padding: '12px 18px',
      borderRadius: '12px',
      color: 'var(--p-text)',
      background: 'transparent',
      border: '2px solid rgba(127,178,255,.9)',
      boxShadow:
        '0 0 20px rgba(127,178,255,.35),' +   // outer glow
        'inset 0 0 8px rgba(127,178,255,.10)', // inner alive
      letterSpacing: '.2px',
      fontWeight: '800'
    });
    node.textContent = 'yourcompany.com';

    stage.append(copy, node);

    // after paint, draw the cable
    requestAnimationFrame(() => {
      activeNode = node;
      drawCableFromNode();
      stage.style.opacity = '1';
      stage.style.transform = 'none';
    });
  };

  const render = () => {
    if (current === 0) renderStep0();
    else if (current === 1) renderStep1();
    else {
      clearStage();
      // placeholders for future steps (2..5) – stay blank for now
    }
    setButtons();
    markStepper();
  };

  // ---- interactions ----
  prevBtn.addEventListener('click', () => {
    current = Math.max(0, current - 1);
    render();
  });
  nextBtn.addEventListener('click', () => {
    current = Math.min(TOTAL_STEPS - 1, current + 1);
    render();
  });

  // Allow clicking the dots to jump (still start at 0 by default)
  rows.forEach((row, idx) => {
    row.addEventListener('click', () => {
      current = idx;
      render();
    });
  });

  // ---- initial state: force 0, keep board quiet until user advances ----
  current = 0;
  render();

  // ---- public destroy (for hot reloads / re-entry) ----
  window.__PROC = {
    destroy() {
      window.removeEventListener('resize', onResize);
      if (host.contains(section)) host.removeChild(section);
    }
  };
})();