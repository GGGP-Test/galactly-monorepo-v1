/* docs/js/onb.common.js */
(function (window) {
  'use strict';

  const LS_KEY = 'onb.seed';

  function normHost(h) {
    let s = (h || '').trim().toLowerCase();
    s = s.replace(/^[a-z]+:\/\/+/i, '');   // strip scheme
    s = s.replace(/^www\./, '');           // strip www.
    s = s.replace(/\/.*$/, '');            // strip path
    s = s.replace(/:\d+$/, '');            // strip port
    s = s.replace(/\s/g, '');              // strip spaces
    return s;
  }

  function domainFromEmail(email) {
    const m = (email || '').trim().toLowerCase().match(/@([^@\s>]+)$/);
    return m ? normHost(m[1]) : '';
  }

  function readSeed() {
    let seed = {};
    try {
      seed = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    } catch {}

    // Also read convenient fallbacks used elsewhere
    try {
      const storedHost = localStorage.getItem('fp.supplier.host');
      if (storedHost && !seed.host) seed.host = normHost(storedHost);
      const email = localStorage.getItem('email');
      if (email && !(seed.contact && seed.contact.email)) {
        seed.contact = seed.contact || {};
        seed.contact.email = email;
      }
      const name = localStorage.getItem('contact.name');
      if (name && !(seed.contact && seed.contact.name)) {
        seed.contact = seed.contact || {};
        seed.contact.name = name;
      }
      const phone = localStorage.getItem('contact.phone');
      if (phone && !(seed.contact && seed.contact.phone)) {
        seed.contact = seed.contact || {};
        seed.contact.phone = phone;
      }
    } catch {}

    // URL params take precedence
    try {
      const q = new URLSearchParams(location.search);
      const role = q.get('role');  if (role) seed.role = role;
      const host = q.get('host');  if (host) seed.host = normHost(host);
      const email = q.get('email'); if (email) {
        seed.contact = seed.contact || {};
        seed.contact.email = email;
        if (!seed.host) seed.host = domainFromEmail(email);
      }
      const name = q.get('name'); if (name) {
        seed.contact = seed.contact || {};
        seed.contact.name = name;
      }
      const phone = q.get('phone'); if (phone) {
        seed.contact = seed.contact || {};
        seed.contact.phone = phone;
      }
    } catch {}

    // Derive host from email if still missing
    if (!seed.host && seed.contact && seed.contact.email) {
      const d = domainFromEmail(seed.contact.email);
      if (d) seed.host = d;
    }

    return seed || {};
  }

  function writeSeed(patch) {
    const cur = readSeed();
    const merged = deepMerge(cur, patch || {});
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(merged));
      if (merged.host) localStorage.setItem('fp.supplier.host', merged.host);
      if (merged.contact?.email)  localStorage.setItem('email', merged.contact.email);
      if (merged.contact?.name)   localStorage.setItem('contact.name', merged.contact.name);
      if (merged.contact?.phone)  localStorage.setItem('contact.phone', merged.contact.phone);
    } catch {}
    return merged;
  }

  function prefillFromSeed(seed) {
    const byId = (id) => document.getElementById(id);
    if (seed?.contact?.name)  { const el = byId('name');  if (el && !el.value)  el.value  = seed.contact.name; }
    if (seed?.contact?.phone) { const el = byId('phone'); if (el && !el.value) el.value  = seed.contact.phone; }
    if (seed?.contact?.email) {
      const el = byId('email');
      if (el && !el.value) el.value = seed.contact.email;
    }
  }

  function goToStep3(seed, path) {
    // Keep it boring: rely on localStorage + optional query for host
    const url = (path || 'step3.html') + (seed?.host ? ('?host=' + encodeURIComponent(seed.host)) : '');
    window.location.href = url;
  }

  function setRoleUI(role) {
    // Optional sugar for toggling chip UI when available
    const sup = document.getElementById('opt-supplier');
    const buy = document.getElementById('opt-buyer');
    if (sup && buy) {
      sup.classList.toggle('active', role === 'supplier');
      buy.classList.toggle('active', role === 'buyer');
      sup.setAttribute('aria-pressed', String(role === 'supplier'));
      buy.setAttribute('aria-pressed', String(role === 'buyer'));
    }
  }

  function deepMerge(base, patch) {
    if (Array.isArray(base) || Array.isArray(patch)) return patch;
    const out = {...(base || {})};
    for (const k in (patch || {})) {
      const v = patch[k];
      out[k] = (v && typeof v === 'object' && !Array.isArray(v))
        ? deepMerge(out[k] || {}, v)
        : v;
    }
    return out;
  }

  // Expose
  window.ONB = {
    normHost,
    domainFromEmail,
    readSeed,
    writeSeed,
    prefillFromSeed,
    goToStep3,
    setRoleUI
  };
})(window);