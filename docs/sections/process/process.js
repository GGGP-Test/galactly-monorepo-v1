/* Section 3 – Process (no pane)
   - Step 0 on load (numbers only)
   - Step 1: left copy + glowing domain node on the right + neon line to board edge
   - No “pane”/box; just the board background you already have
*/

(() => {
  'use strict';

  // Destroy any previous mount to prevent “already declared” issues
  if (window.__PROC && typeof window.__PROC.destroy === 'function') {
    window.__PROC.destroy();
  }

  const DATA = window.PROCESS_DATA;
  const host = document.getElementById('section-process');
  if (!host || !DATA) return;

  // ---------- theme tokens -> section scope ----------
  const applyTheme = () => {
    const t = DATA.theme || {};
    const set = (k, v) => v != null && host.style.setProperty(k, String(v));
    set('--p-bg', t.bg);            set('--p-text', t.text);
    set('--p-muted', t.muted);      set('--p-stroke', t.stroke);
    set('--p-primary', t.primary);  set('--p-secondary', t.secondary);
    set('--p-tertiary', t.tertiary);
    set('--p-cable', t.cable);      set('--p-cable-dim', t.cableDim);
    if (t.glass) {
      set('--glass-fill', t.glass.fill);
      set('--glass-stroke', t.glass.stroke);
      set('--glass-blur', `${t.glass.blurPx || 10}px`);
      set('--glass-hover', t.glass.hoverFill);
      set('--glass-active', t.glass.activeFill);
    }
  };

  // ---------- helpers ----------
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };

  // ---------- skeleton ----------
  host.innerHTML = '';

  const section = el('section', 'proc-section');
  const inner   = el('div', 'proc-inner');
  const wrap    = el('div', 'p-wrap');

  // Left dock (0..5 + CTAs)
  const dock    = el('aside', 'p-dock');
  const stepper = el('div', 'p-stepper');
  const TOTAL_STEPS = 6; // 0..5

  for (let i = 0; i < TOTAL_STEPS; i++) {
    const row = el('div', 'p-step');
    row.append(el('div', 'p-dot', String(i)), el('div', 'p-label', ''));
    stepper.appendChild(row);
  }

  const ctas    = el('div', 'p-ctas');
  const prevBtn = el('button', 'btn-glass', 'Prev step');
  const nextBtn = el('button', 'btn-glass', 'Next step');
  ctas.append(prevBtn, nextBtn);
  dock.append(stepper, ctas);

  // Right board (no pane; only SVG cable + stage content)
  const board   = el('section', 'p-board');
  const svg     = el('svg', 'proc-svg');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  const cable   = el('path', 'proc-cable is-dim');
  svg.appendChild(cable);

  const stage   = el('div'); // holds step content; no class -> CSS won’t style it as a pane
  Object.assign(stage.style, { position: 'relative', minHeight: '420px' });

  board.append(svg, stage);
  wrap.append(dock, board);
  inner.appendChild(wrap);
  section.appendChild(inner);
  host.appendChild(section);

  applyTheme();

  // ---------- state ----------
  let current = 0; // force step 0 on load
  const rows = Array.from(stepper.querySelectorAll('.p-step'));
  let activeNode = null;

  const setButtons = () => {
    prevBtn.disabled = current <= 0;
    nextBtn.disabled = current >= TOTAL_STEPS - 1;
  };

  const markStepper = () => {
    rows.forEach((r, i) => {
      r.classList.toggle('is-current', i === current);
      r.classList.toggle('is-done', i < current);
    });
  };

  const clearStage = () => {
    stage.innerHTML = '';
    activeNode = null;
    cable.setAttribute('d', '');
    cable.classList.add('is-dim');
  };

  // Compute a soft cubic path from node → board right edge
  const drawCableFromNode = () => {
    if (!activeNode) return;
    const bb = board.getBoundingClientRect();
    const rb = activeNode.getBoundingClientRect();

    const sx = rb.right - bb.left;                   // start at node’s right edge
    const sy = rb.top + rb.height * 0.6 - bb.top;    // gently below mid
    const ex = bb.width - 18;                         // just inside board edge
    const ey = sy + 6;

    const c1x = sx + Math.max(60, bb.width * 0.10);
    const c2x = sx + Math.max(140, bb.width * 0.28);

    cable.setAttribute('d', `M ${sx} ${sy} C ${c1x} ${sy}, ${c2x} ${ey}, ${ex} ${ey}`);
    cable.classList.remove('is-dim');
  };

  // Resize -> redraw path
  const onResize = (() => {
    let raf = 0;
    return () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(drawCableFromNode);
    };
  })();
  window.addEventListener('resize', onResize);

  // ---------- renderers ----------
  const renderStep0 = () => {
    clearStage();
    // nothing on the board; numbers-only tease
  };

  const renderStep1 = () => {
    clearStage();

    // Left copy (kept clear of the dock; constrained width)
    const copy = el('div', '');
    Object.assign(copy.style, {
      position: 'absolute',
      left: '18px',
      top: '18px',
      maxWidth: '360px',
      lineHeight: '1.35'
    });
    copy.innerHTML = `
      <h3 style="margin:0 0 8px; font:800 22px/1.1 'Newsreader', Georgia, serif;">
        We start with your company.
      </h3>
      <p style="margin:0; color:var(--p-muted); font-size:14px;">
        We read your company and data to learn what matters. Then our system
        builds simple metrics around your strengths. With that map in hand, we
        move forward to find real buyers who match your persona.
      </p>
    `;

    // Glowing domain node (stroke-only look)
    const node = el('div', '');
    Object.assign(node.style, {
      position: 'absolute',
      right: '52px',
      top: '64px',
      padding: '12px 18px',
      borderRadius: '12px',
      color: 'var(--p-text)',
      background: 'transparent',
      border: '2px solid rgba(127,178,255,.92)',
      boxShadow: '0 0 18px rgba(127,178,255,.35), inset 0 0 8px rgba(127,178,255,.12)',
      fontWeight: '800',
      letterSpacing: '.2px',
      whiteSpace: 'nowrap'
    });
    node.textContent = 'yourcompany.com';

    stage.append(copy, node);

    // draw path after layout
    requestAnimationFrame(() => {
      activeNode = node;
      drawCableFromNode();
    });
  };

  const render = () => {
    if (current === 0) renderStep0();
    else if (current === 1) renderStep1();
    else clearStage(); // later steps will fill in as you approve
    setButtons();
    markStepper();
  };

  // ---------- interactions ----------
  prevBtn.addEventListener('click', () => {
    current = Math.max(0, current - 1);
    render();
  });
  nextBtn.addEventListener('click', () => {
    current = Math.min(TOTAL_STEPS - 1, current + 1);
    render();
  });
  rows.forEach((row, idx) => {
    row.addEventListener('click', () => {
      current = idx;
      render();
    });
  });

  // Initial state: 0 (numbers only)
  current = 0;
  render();

  // Expose destroy for hot reloads
  window.__PROC = {
    destroy() {
      window.removeEventListener('resize', onResize);
      if (host.contains(section)) host.removeChild(section);
    }
  };
})();