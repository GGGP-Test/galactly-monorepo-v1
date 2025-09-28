// public/script.js
// Keeps your admin "Find buyers" panel intact AND adds onboarding helpers
// for Step 3 (one-liner + product signals) that call /api/classify correctly.

(function () {
  // ---------- Admin panel (existing) ----------
  const els = {
    base: document.querySelector("#apiBase"),
    key: document.querySelector("#apiKey"),
    apply: document.querySelector("#btnApply"),
    region: document.querySelector("#region"),
    radius: document.querySelector("#radius"),
    domain: document.querySelector("#supplierDomain"),
    btnFind: document.querySelector("#btnFindBuyers"),
    toast: document.querySelector("#toast"),
    hotBtn: document.querySelector("#btnRefreshHot"),
    warmBtn: document.querySelector("#btnRefreshWarm"),
    tableBody: document.querySelector("#leadsTbody"),
    status: document.querySelector("#statusText"),
  };

  function saveLocal() {
    els.base && localStorage.setItem("apiBase", els.base.value.trim());
    els.key && localStorage.setItem("apiKey", els.key.value.trim());
  }
  function loadLocal() {
    const b = localStorage.getItem("apiBase");
    const k = localStorage.getItem("apiKey");
    if (els.base && b) els.base.value = b;
    if (els.key && k) els.key.value = k;
  }
  function toast(msg, kind = "info") {
    if (!els.toast) return alert(msg);
    els.toast.textContent = msg;
    els.toast.className = `toast ${kind}`;
    els.toast.style.display = "block";
    setTimeout(() => (els.toast.style.display = "none"), 4000);
  }
  function normDomain(s) {
    if (!s) return "";
    s = s.trim().toLowerCase();
    s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
    const idx = s.indexOf("/");
    if (idx >= 0) s = s.slice(0, idx);
    return s;
  }

  function apiBaseRaw() {
    // Prefer the visible input if present; fall back to localStorage
    const fromInput = els.base && els.base.value ? els.base.value.trim() : "";
    const fromLS = localStorage.getItem("apiBase") || "";
    return (fromInput || fromLS).replace(/\/+$/, "");
  }
  function apiHeaders() {
    const key = (els.key && els.key.value.trim()) || localStorage.getItem("apiKey") || "";
    return Object.assign({ "Content-Type": "application/json" }, key ? { "x-api-key": key } : {});
  }

  async function api(path, opts = {}) {
    const base = apiBaseRaw();
    const headers = Object.assign({}, apiHeaders(), opts.headers || {});
    const resp = await fetch(`${base}${path}`, { credentials: "omit", ...opts, headers });
    let body = null;
    try {
      body = await resp.json();
    } catch { /* ignore non-JSON */ }
    return { status: resp.status, ok: resp.ok, body };
  }

  async function findBuyers() {
    if (!els.btnFind) return;
    const domainRaw = els.domain ? els.domain.value : "";
    const domain = normDomain(domainRaw);
    if (!domain) return toast("Please enter a supplier domain (e.g. acme.com)", "warn");

    els.btnFind.disabled = true;
    els.btnFind.textContent = "Finding buyers...";
    els.status && (els.status.textContent = "Finding buyers…");

    const payload = {
      domain, // <<< IMPORTANT: always send as `domain`
      region: els.region?.value || "US/CA",
      radiusMi: Number(els.radius?.value || 50),
      // persona: optional later
    };

    const { status, body } = await api("/api/v1/leads/find-buyers", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (status === 400) {
      toast((body && body.error) || "Bad request", "error");
    } else if (status >= 500) {
      toast("Server error. Try again.", "error");
    } else {
      const created = body?.created ?? 0;
      const hot = body?.hot ?? 0;
      const warm = body?.warm ?? 0;
      toast(`Created ${created} candidate(s). Hot:${hot} Warm:${warm}. Refresh lists to view.`, "info");
    }

    els.btnFind.disabled = false;
    els.btnFind.textContent = "Find buyers";
    els.status && (els.status.textContent = "");
  }

  async function refreshList(temp) {
    const { body } = await api(`/api/v1/leads?temp=${encodeURIComponent(temp)}&region=usca`);
    if (!Array.isArray(body) || !els.tableBody) return;
    els.tableBody.innerHTML = "";
    for (const l of body) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${l.id || ""}</td>
        <td>${l.domain || l.website || ""}</td>
        <td>${l.platform || "web"}</td>
        <td>${l.title || ""}</td>
        <td>${new Date(l.createdAt || Date.now()).toLocaleString()}</td>
        <td>${l.temp || ""}</td>
        <td>${(l.why || l.meta?.why || "").toString().slice(0, 120)}</td>`;
      els.tableBody.appendChild(tr);
    }
  }

  // ---------- Onboarding modal additions ----------
  // Works only if the Step 2/3 elements exist on the page.

  // Normalize to '<base>/api' for classify calls
  function apiBaseForClassify() {
    const raw = apiBaseRaw(); // may already include /api or not
    if (!raw) return "";
    return /\/api\/?$/i.test(raw) ? raw.replace(/\/+$/, "") : `${raw}/api`;
  }

  function setApiBaseInteractive() {
    const current = apiBaseRaw();
    const val = window.prompt(
      "API base (ends with /api). Example:\nhttps://YOUR-NORTHFLANK-SUBDOMAIN.code.run/api",
      current || "https://…your-subdomain….code.run/api"
    );
    if (!val) return;
    const trimmed = val.trim();
    // Store without trailing slash; we keep original admin input in sync if present
    localStorage.setItem("apiBase", trimmed.replace(/\/+$/, ""));
    if (els.base) els.base.value = trimmed.replace(/\/+$/, "");
    toast("API base saved.");
  }

  async function classify(host, email) {
    const base = apiBaseForClassify();
    if (!base) {
      setApiBaseInteractive();
      throw new Error("api_base_not_set");
    }
    const url = new URL(`${base}/classify`);
    url.searchParams.set("host", host);
    if (email) url.searchParams.set("email", email);
    const resp = await fetch(url.toString(), { credentials: "omit", headers: apiHeaders() });
    if (!resp.ok) throw new Error(`http_${resp.status}`);
    return await resp.json();
  }

  // Update the one-liner + product chips inside Step 3
  async function refreshSummary(host, email) {
    const statusEl = document.querySelector("[data-summary]");
    if (statusEl) statusEl.textContent = `${host} — fetching summary…`;

    try {
      const data = await classify(host, email);
      if (!data || data.ok === false) {
        const reason = data?.error || "network error";
        if (statusEl) statusEl.textContent = `${host} — ${reason} while reading your site.`;
        return;
      }

      // 1-liner
      const one = data.summary || `${data.host} sells packaging to brands.`;
      if (statusEl) statusEl.textContent = one;

      // favicon (gstatic)
      const fav = document.getElementById("company-favicon");
      if (fav) fav.src =
        `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=64&url=https://${encodeURIComponent(data.host)}`;

      // product signals → chips
      const chipBox = document.querySelector("[data-product-chips]");
      if (chipBox) {
        chipBox.innerHTML = "";
        const tags = (data.productTags || []).slice(0, 12);
        if (tags.length === 0) {
          chipBox.insertAdjacentHTML(
            "beforeend",
            `<span class="muted">Tap to select. We’ll use these as focus tags.</span>`
          );
        } else {
          for (const t of tags) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "chip";
            btn.textContent = t;
            btn.addEventListener("click", () => btn.classList.toggle("chip--on"));
            chipBox.appendChild(btn);
          }
        }
      }
    } catch (err) {
      const msg = (err && err.message) || String(err);
      if (msg === "api_base_not_set") return; // user will retry after setting
      const statusEl = document.querySelector("[data-summary]");
      if (statusEl) statusEl.textContent = `${host} — network error while reading your site.`;
    }
  }

  // Auto-fill domain from business email (handles browser autofill)
  function wireEmailToDomain() {
    const emailEl = document.getElementById("business-email");
    const domainEl = document.getElementById("domain");
    if (!emailEl || !domainEl) return;

    const sync = () => {
      const v = String(emailEl.value || "");
      const m = v.match(/@([a-z0-9.-]+\.[a-z]{2,})/i);
      if (m) domainEl.value = m[1].toLowerCase();
    };
    ["input", "change", "blur"].forEach(ev => emailEl.addEventListener(ev, sync));
    // Try once after load for saved autofill
    setTimeout(sync, 120);
  }

  // Wire “Refresh from website” and the settings cog if present
  function wireOnboardingActions() {
    document.querySelectorAll("[data-action='set-api']").forEach(el => {
      el.addEventListener("click", (e) => { e.preventDefault(); setApiBaseInteractive(); });
    });
    document.querySelectorAll("[data-action='refresh']").forEach(el => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        const host = (document.getElementById("domain")?.value || "").trim().toLowerCase();
        const email = (document.getElementById("business-email")?.value || "").trim().toLowerCase();
        if (!host) return toast("Add your website first.", "warn");
        refreshSummary(host, email);
      });
    });
  }

  // ---------- boot ----------
  loadLocal();

  // Admin page wires (if present)
  els.apply && els.apply.addEventListener("click", () => { saveLocal(); toast("Applied API base & key.", "info"); });
  els.btnFind && els.btnFind.addEventListener("click", () => findBuyers());
  els.hotBtn && els.hotBtn.addEventListener("click", () => refreshList("hot"));
  els.warmBtn && els.warmBtn.addEventListener("click", () => refreshList("warm"));
  if (els.tableBody) { refreshList("warm").catch(() => {}); }

  // Onboarding wires (safe no-ops on pages that don’t have these elements)
  wireEmailToDomain();
  wireOnboardingActions();

  // Expose minimal surface if index.html wants to call directly
  window.Galactly = Object.assign(window.Galactly || {}, {
    setApiBaseInteractive,
    refreshSummary,
  });
})();