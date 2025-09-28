// docs/script.js
// Onboarding glue: robust email→domain autofill + safe classify fetcher
// that works whether your API base includes /api or not. Also auto-triggers
// classify when moving from Step 2 → Step 3 (or when domain becomes valid).

(function () {
  // ------------- tiny helpers -------------
  const LS = {
    apiBase: "apiBase",
    apiKey: "apiKey",
  };

  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));

  const getApiBase = () =>
    (document.documentElement.getAttribute("data-api-base") ||
      localStorage.getItem(LS.apiBase) ||
      qs('meta[name="api-base"]')?.getAttribute("content") ||
      ""
    ).trim().replace(/\/+$/, "");

  const setApiBase = (raw) => {
    if (!raw) return;
    const v = raw.trim().replace(/\/+$/, "");
    localStorage.setItem(LS.apiBase, v);
    console.info("[onboarding] saved apiBase:", v);
  };

  const promptApiBase = () => {
    const cur = getApiBase();
    const v = window.prompt(
      "API base (with or without /api). Example:\nhttps://YOUR-SUBDOMAIN.code.run/api",
      cur || ""
    );
    if (v) setApiBase(v);
  };

  const hdrs = () => {
    const h = { "Content-Type": "application/json" };
    const k = localStorage.getItem(LS.apiKey) || "";
    if (k) h["x-api-key"] = k;
    return h;
  };

  const join = (base, tail) => `${base.replace(/\/+$/, "")}/${String(tail).replace(/^\/+/, "")}`;

  const normHost = (s) => {
    if (!s) return "";
    return String(s)
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "");
  };

  // ------------- DOM targets (very tolerant) -------------
  function findEmailInput() {
    return (
      qs("#business-email") ||
      qs("#email") ||
      qs('input[type="email"]') ||
      qs('input[name*="email" i]')
    );
  }

  function findDomainInput() {
    return (
      qs("#supplierDomain") ||   // panel page id
      qs("#domain") ||
      qs("#website") ||
      qs('input[name*="domain" i]') ||
      qs('input[name*="website" i]')
    );
  }

  function findSummaryEl() {
    return qs("[data-summary]") || qs("#summaryLine") || qs(".summary-line");
  }

  function findRefreshLink() {
    return (
      qsa("[data-action='refresh']").at(0) ||
      qs("#refresh-from-website") ||
      // the text link inside the one-liner card
      qsa("a").find(a => /refresh from website/i.test(a.textContent || ""))
    );
  }

  function findNextButtons() {
    // Buttons that likely move steps
    return qsa("button").filter(b => /^(next|finish)$/i.test(b.textContent.trim()));
  }

  function setSummaryText(txt) {
    const el = findSummaryEl();
    if (el) el.textContent = txt;
  }

  function setFaviconFor(host) {
    const img = qs("#company-favicon");
    if (!img || !host) return;
    img.src =
      `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=64&url=https://${encodeURIComponent(host)}`;
  }

  function setProductChips(tags) {
    const box = qs("[data-product-chips]") || qs("#product-chips");
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

  // ------------- classify: try both paths safely -------------
  async function fetchClassify(host, email) {
    const base = getApiBase();
    if (!base) {
      promptApiBase();
      throw new Error("api_base_missing");
    }
    const hostClean = normHost(host);
    if (!hostClean) throw new Error("bad_host");

    const attempt = async (url) => {
      const r = await fetch(url, { credentials: "omit", headers: hdrs() });
      const txt = await r.text();
      let json = null;
      if (/^\s*[\{\[]/.test(txt)) { try { json = JSON.parse(txt); } catch {} }
      return { ok: r.ok, status: r.status, txt, json };
    };

    // Candidate 1: whatever user pasted + "/classify"
    const u1 = new URL(join(base, "/classify"));
    u1.searchParams.set("host", hostClean);
    if (email) u1.searchParams.set("email", email);

    // Candidate 2: ensure "/api/classify"
    const baseNoApi = base.replace(/\/api\/?$/i, "");
    const u2 = new URL(join(baseNoApi, "/api/classify"));
    u2.searchParams.set("host", hostClean);
    if (email) u2.searchParams.set("email", email);

    const a1 = await attempt(u1.toString());
    if (a1.json && (a1.json.ok === true || a1.json.host)) return a1.json;

    const looksWrong =
      !a1.ok || /Cannot\s+GET\s+\/classify/i.test(a1.txt || "");
    if (looksWrong) {
      const a2 = await attempt(u2.toString());
      if (a2.json && (a2.json.ok === true || a2.json.host)) return a2.json;
      throw new Error(`classify_failed:${a2.status}:${(a2.txt || "").slice(0, 200)}`);
    }
    if (a1.json && a1.json.ok === false) {
      throw new Error(`classify_error:${a1.json.error || "unknown"}`);
    }
    throw new Error(`classify_failed:${a1.status}:${(a1.txt || "").slice(0, 200)}`);
  }

  // ------------- wire email → domain (immediate on "@") -------------
  function wireEmailToDomain() {
    const emailEl = findEmailInput();
    const domainEl = findDomainInput();
    if (!emailEl || !domainEl) return;

    const applyFrom = (val) => {
      const m = String(val || "").match(/@([a-z0-9.-]+\.[a-z]{2,})/i);
      if (m) {
        const d = m[1].toLowerCase();
        if (domainEl.value !== d) {
          domainEl.value = d;
          domainEl.dispatchEvent(new Event("input", { bubbles: true }));
          document.dispatchEvent(new CustomEvent("domain:changed", { detail: d }));
        }
      }
    };

    // Key events: update as soon as the user types "@"
    const onInput = () => applyFrom(emailEl.value);
    emailEl.addEventListener("input", onInput);
    emailEl.addEventListener("keyup", onInput);
    emailEl.addEventListener("change", onInput);
    emailEl.addEventListener("paste", () => setTimeout(onInput, 0));

    // Browser autofill: poll briefly after focus
    emailEl.addEventListener("focus", () => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        applyFrom(emailEl.value);
        if (Date.now() - t0 > 2000) clearInterval(iv);
      }, 120);
    });

    // Initial sync (handles pre-filled states)
    setTimeout(onInput, 50);
  }

  // ------------- connect domain → crawl (auto classify) -------------
  let classifyDebounce = 0;
  const scheduleClassify = (ms = 300) => {
    clearTimeout(classifyDebounce);
    classifyDebounce = setTimeout(() => {
      refreshFromWebsite();
    }, ms);
  };

  function wireDomainChangeTriggers() {
    const domainEl = findDomainInput();
    if (!domainEl) return;
    const onChange = () => {
      const d = normHost(domainEl.value);
      if (d) scheduleClassify(300);
    };
    ["input", "change", "blur"].forEach(ev => domainEl.addEventListener(ev, onChange));
    document.addEventListener("domain:changed", () => scheduleClassify(150));
  }

  function wireStepTransitions() {
    // If the UI has explicit Next/Finish buttons, trigger classify just after click.
    findNextButtons().forEach(btn => {
      btn.addEventListener("click", () => {
        // give the UI a moment to swap to Step 3, then run classify
        setTimeout(() => scheduleClassify(0), 350);
      });
    });
  }

  // Manual “Refresh from website” link
  async function refreshFromWebsite() {
    const domainEl = findDomainInput();
    const emailEl = findEmailInput();
    const host = normHost(domainEl?.value || "");
    const email = (emailEl?.value || "").trim().toLowerCase();

    if (!host) {
      // nudge user to add API if missing too
      const base = getApiBase();
      if (!base) promptApiBase();
      setSummaryText("Add your website first (e.g. acme.com).");
      return;
    }

    setSummaryText(`${host} — fetching summary…`);
    try {
      const data = await fetchClassify(host, email);
      const realHost = data.host || host;

      // accept both legacy and new shapes
      const summary =
        data.summary ||
        `${realHost} sells packaging to brands.`;

      const productTags = data.productTags || data.products || data.product_signals || [];

      setSummaryText(summary);
      setFaviconFor(realHost);
      setProductChips(productTags);
    } catch (err) {
      console.warn("[onboarding] classify error:", err);
      setSummaryText(`${host} — network error while reading your site.`);
    }
  }

  function wireManualActions() {
    // “gear” to set API base
    qsa("[data-action='set-api'], #set-api-base").forEach(el => {
      el.addEventListener("click", (e) => { e.preventDefault(); promptApiBase(); });
    });
    // “Refresh from website”
    const refreshEl = findRefreshLink();
    if (refreshEl) {
      refreshEl.addEventListener("click", (e) => { e.preventDefault(); refreshFromWebsite(); });
    }
  }

  // ------------- boot -------------
  wireEmailToDomain();
  wireDomainChangeTriggers();
  wireStepTransitions();
  wireManualActions();

  // expose a tiny API for inline handlers if needed
  window.Galactly = Object.assign(window.Galactly || {}, {
    setApiBase: promptApiBase,
    refreshFromWebsite,
  });
})();