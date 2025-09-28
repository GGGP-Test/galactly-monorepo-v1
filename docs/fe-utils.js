// docs/fe-utils.js
// Central API base resolver + tiny fetch helpers.
// Works on GitHub Pages or any static host. One-time "?api=<base>" sets and persists.

(function () {
  const LS_KEY = "apiBase";
  const QS_KEY = "api"; // usage: ?api=https://your-northflank-host/api
  const DEFAULT_REL = "/api"; // when frontend is served by the same origin as backend

  function norm(u) {
    if (!u) return "";
    try {
      // Allow relative "/api" or absolute "https://host/api"
      if (u.startsWith("/")) return u.replace(/\/+$/, "");
      const url = new URL(u);
      // strip trailing slash
      url.pathname = url.pathname.replace(/\/+$/, "");
      return url.toString();
    } catch {
      return "";
    }
  }

  function resolveBase() {
    // 1) querystring override (one-time set)
    const sp = new URLSearchParams(location.search);
    const qs = sp.get(QS_KEY);
    if (qs) {
      const v = norm(qs);
      if (v) localStorage.setItem(LS_KEY, v);
      // Clean the URL (no reload) after capturing the value
      sp.delete(QS_KEY);
      const clean = location.pathname + (sp.toString() ? "?" + sp.toString() : "") + location.hash;
      history.replaceState({}, "", clean);
    }

    // 2) persisted
    const saved = norm(localStorage.getItem(LS_KEY) || "");

    // 3) if we’re running on a backend host (e.g., *.code.run), relative works
    const host = location.hostname;
    const looksLikeBackend =
      /\.code\.run$/.test(host) || /\.onrender\.com$/.test(host) || /\.vercel\.app$/.test(host);

    // Prefer saved if absolute, else fall back to same-origin when we’re on a backend,
    // else stay with saved (could be absolute), else default relative (will 404 on GitHub).
    let base = saved || (looksLikeBackend ? DEFAULT_REL : saved) || DEFAULT_REL;

    // If still relative on a non-backend host (like GitHub Pages), we’ll show a chip to set it.
    return norm(base);
  }

  function getBase() {
    return window.API_BASE || (window.API_BASE = resolveBase());
  }

  function setBase(next) {
    const v = norm(next);
    if (!v) return;
    window.API_BASE = v;
    localStorage.setItem(LS_KEY, v);
    showChip(true);
  }

  async function apiFetch(path, opts = {}) {
    const base = getBase();
    const isAbsolute = /^https?:\/\//i.test(base);
    const url = isAbsolute ? base + path : base + path; // both cases OK since base has no trailing slash
    try {
      const res = await fetch(url, {
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        ...opts,
      });
      // Help debug wrong base quickly
      if (res.status === 404 && isAbsolute) {
        console.warn("[API] 404 from", url, "— check the API base");
      }
      return res;
    } catch (e) {
      console.error("[API] network error:", e);
      throw e;
    }
  }

  async function apiGet(path) {
    const r = await apiFetch(path, { method: "GET" });
    return r.ok ? r.json() : Promise.reject({ status: r.status, text: await r.text() });
  }

  async function apiPost(path, body) {
    const r = await apiFetch(path, { method: "POST", body: JSON.stringify(body || {}) });
    return r.ok ? r.json() : Promise.reject({ status: r.status, text: await r.text() });
  }

  // --- tiny floating chip to visualize/change API base (optional, small but handy) ---
  function showChip(force) {
    if (document.getElementById("api-base-chip") && !force) return;
    const chip = document.getElementById("api-base-chip") || document.createElement("button");
    chip.id = "api-base-chip";
    chip.textContent = "API";
    chip.title = `API base: ${getBase()}\nClick to change`;
    Object.assign(chip.style, {
      position: "fixed",
      right: "10px",
      bottom: "10px",
      zIndex: 9999,
      padding: "6px 10px",
      borderRadius: "999px",
      border: "1px solid rgba(255,255,255,0.2)",
      background: "rgba(0,0,0,0.35)",
      color: "white",
      fontSize: "12px",
      cursor: "pointer",
      backdropFilter: "blur(4px)",
    });
    chip.onclick = () => {
      const cur = getBase();
      const v = prompt(
        "Set API base (absolute URL ending with /api, e.g. https://your-service.code.run/api)\n\nCurrent:",
        cur
      );
      if (v) setBase(v);
    };
    if (!chip.parentNode) document.body.appendChild(chip);
  }

  // Expose globals for existing code
  window.API_BASE = getBase();
  window.apiGet = apiGet;
  window.apiPost = apiPost;
  window.setApiBase = setBase;

  // Render the chip if likely misconfigured (GitHub Pages + relative base)
  const onStaticHost = /github\.io$/.test(location.host);
  const base = getBase();
  if (onStaticHost && !/^https?:\/\//i.test(base)) {
    // encourage setting once via ?api=
    showChip();
    console.warn(
      "[API] You are on a static host. Set your API base by adding ?api=https://<your-northflank-host>/api to the URL."
    );
  }
})();