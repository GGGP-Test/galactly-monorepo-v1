// docs/script.js
// Onboarding helpers for the landing modal (frontend-only).
// Robustly calls your backend /classify regardless of how the API base is pasted,
// and auto-fills domain from business email (works with browser autofill too).

(function () {
  // ---------- utilities ----------
  const LS_KEY = "apiBase"; // where we store your API base

  function getApiBaseRaw() {
    const fromAttr = document.documentElement.getAttribute("data-api-base") || "";
    const fromLS = localStorage.getItem(LS_KEY) || "";
    const fromMeta = (document.querySelector('meta[name="api-base"]')?.getAttribute("content")) || "";
    return (fromAttr || fromLS || fromMeta || "").trim().replace(/\/+$/, "");
  }

  function setApiBase(raw) {
    if (!raw) return;
    const v = raw.trim().replace(/\/+$/, "");
    localStorage.setItem(LS_KEY, v);
    console.info("[onboarding] apiBase saved:", v);
  }

  function promptApiBase() {
    const cur = getApiBaseRaw();
    const val = window.prompt(
      "API base (can be with or without /api).\nExample: https://YOUR-SUBDOMAIN.code.run/api",
      cur || "https://…your-subdomain….code.run/api"
    );
    if (val) setApiBase(val);
  }

  function headers() {
    const h = { "Content-Type": "application/json" };
    const apiKey = localStorage.getItem("apiKey") || ""; // optional
    if (apiKey) h["x-api-key"] = apiKey;
    return h;
  }

  // Smart join without double slashes
  function join(base, tail) {
    return `${base.replace(/\/+$/, "")}/${String(tail).replace(/^\/+/, "")}`;
  }

  // Try both /classify and /api/classify depending on what user pasted
  async function classifyFetch(host, email) {
    const base = getApiBaseRaw();
    if (!base) {
      promptApiBase();
      throw new Error("api_base_missing");
    }

    // Candidate #1: base + "/classify"
    const u1 = new URL(join(base, "/classify"));
    u1.searchParams.set("host", host);
    if (email) u1.searchParams.set("email", email);

    // Candidate #2: (base without trailing /api) + "/api/classify"
    const baseNoApi = base.replace(/\/api\/?$/i, "");
    const u2 = new URL(join(baseNoApi, "/api/classify"));
    u2.searchParams.set("host", host);
    if (email) u2.searchParams.set("email", email);

    // If base already ends with /api, u1 => “…/api/classify” (good), u2 is identical.
    // If base lacks /api, u1 => “…/classify” (likely 404), u2 => “…/api/classify” (good).
    // We’ll try u1 first, then u2 if 404-ish HTML like “Cannot GET /classify”.

    const tryOnce = async (url) => {
      const resp = await fetch(url.toString(), { credentials: "omit", headers: headers() });
      let bodyText = "";
      try { bodyText = await resp.text(); } catch {}
      // Parse JSON if it looks like JSON
      let parsed = null;
      if (bodyText && /^\s*[\{\[]/.test(bodyText)) {
        try { parsed = JSON.parse(bodyText); } catch {}
      }
      return { ok: resp.ok, status: resp.status, text: bodyText, json: parsed };
    };

    const r1 = await tryOnce(u1);
    // Fast-path if r1 ok JSON with ok:true
    if (r1.json && (r1.json.ok === true || r1.json.host)) return r1.json;

    // If r1 failed or returned “Cannot GET /classify”, try the other URL
    const looksWrong =
      !r1.ok ||
      (typeof r1.text === "string" && /Cannot\s+GET\s+\/classify/i.test(r1.text));

    if (looksWrong) {
      const r2 = await tryOnce(u2);
      if (r2.json && (r2.json.ok === true || r2.json.host)) return r2.json;
      const msg = r2.text || "classify-failed";
      throw new Error(`classify_failed:${r2.status}:${msg.slice(0, 160)}`);
    }

    // If r1 returned JSON but not ok, throw that
    if (r1.json && r1.json.ok === false) {
      throw new Error(`classify_error:${r1.json.error || "unknown"}`);
    }
    throw new Error(`classify_failed:${r1.status}:${String(r1.text).slice(0,160)}`);
  }

  // ---------- UI helpers ----------
  function q(sel) { return document.querySelector(sel); }
  function qa(sel) { return Array.from(document.querySelectorAll(sel)); }

  // Find email & domain inputs broadly
  function locateEmailInput() {
    return (
      q("#business-email") ||
      q('input[type="email"]') ||
      q('input[name*="email" i]')
    );
  }
  function locateDomainInput() {
    return (
      q("#domain") ||
      q("#website") ||
      q('input[name*="domain" i]') ||
      q('input[name*="website" i]')
    );
  }

  // Auto-fill domain from email (handles autofill)
  function wireEmailToDomain() {
    const emailEl = locateEmailInput();
    const domainEl = locateDomainInput();
    if (!emailEl || !domainEl) return;

    const sync = () => {
      const v = String(emailEl.value || "");
      const m = v.match(/@([a-z0-9.-]+\.[a-z]{2,})/i);
      if (m) domainEl.value = m[1].toLowerCase();
    };
    ["input", "change", "blur"].forEach(ev => emailEl.addEventListener(ev, sync));
    // Try after browser autofill
    setTimeout(sync, 150);
  }

  function setSummary(text) {
    const el =
      q("[data-summary]") ||
      q("#summaryLine") ||
      q(".summary-line");
    if (el) el.textContent = text;
  }

  function setFavicon(host) {
    const img = q("#company-favicon");
    if (!img || !host) return;
    img.src = `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=64&url=https://${encodeURIComponent(host)}`;
  }

  function renderProductChips(tags) {
    const box =
      q("[data-product-chips]") ||
      q("#product-chips");
    if (!box) return;
    box.innerHTML = "";
    const list = Array.isArray(tags) ? tags.slice(0, 12) : [];
    if (list.length === 0) {
      box.insertAdjacentHTML("beforeend", `<span class="muted">Tap to select. We’ll use these as focus tags.</span>`);
      return;
    }
    for (const t of list) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.textContent = t;
      btn.addEventListener("click", () => btn.classList.toggle("chip--on"));
      box.appendChild(btn);
    }
  }

  async function refreshFromWebsite() {
    const host = (locateDomainInput()?.value || "").trim().toLowerCase();
    const email = (locateEmailInput()?.value || "").trim().toLowerCase();
    if (!host) {
      alert("Add your website first (e.g. acme.com).");
      return;
    }
    setSummary(`${host} — fetching summary…`);
    try {
      const data = await classifyFetch(host, email);
      // Accept both new or fallback shapes
      const summary = data.summary || `${data.host || host} sells packaging to brands.`;
      const productTags = data.productTags || data.products || [];
      const realHost = data.host || host;

      setSummary(summary);
      setFavicon(realHost);
      renderProductChips(productTags);
    } catch (err) {
      console.warn("[onboarding] classify error:", err);
      setSummary(`${host} — network error while reading your site.`);
    }
  }

  function wireActions() {
    // Gear / API base
    qa("[data-action='set-api'], #set-api-base").forEach(el => {
      el.addEventListener("click", (e) => { e.preventDefault(); promptApiBase(); });
    });
    // Refresh link
    qa("[data-action='refresh'], #refresh-from-website").forEach(el => {
      el.addEventListener("click", (e) => { e.preventDefault(); refreshFromWebsite(); });
    });
  }

  // ---------- boot ----------
  wireEmailToDomain();
  wireActions();

  // Optional: expose small API for inline onclick handlers
  window.Galactly = Object.assign(window.Galactly || {}, {
    setApiBase: promptApiBase,
    refreshFromWebsite,
  });
})();