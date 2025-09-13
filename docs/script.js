// public/script.js
(function () {
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
    localStorage.setItem("apiBase", els.base.value.trim());
    localStorage.setItem("apiKey", els.key.value.trim());
  }
  function loadLocal() {
    const b = localStorage.getItem("apiBase");
    const k = localStorage.getItem("apiKey");
    if (b) els.base.value = b;
    if (k) els.key.value = k;
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

  async function api(path, opts = {}) {
    const base = els.base.value.trim().replace(/\/+$/, "");
    const key = els.key.value.trim();
    const headers = Object.assign(
      { "Content-Type": "application/json" },
      key ? { "x-api-key": key } : {}
    );
    const resp = await fetch(`${base}${path}`, { credentials: "omit", ...opts, headers });
    let body = null;
    try {
      body = await resp.json();
    } catch { /* ignore */ }
    return { status: resp.status, ok: resp.ok, body };
  }

  async function findBuyers() {
    const domainRaw = els.domain.value;
    const domain = normDomain(domainRaw);
    if (!domain) return toast("Please enter a supplier domain (e.g. acme.com)", "warn");

    els.btnFind.disabled = true;
    els.btnFind.textContent = "Finding buyers...";
    els.status && (els.status.textContent = "Finding buyers…");

    const payload = {
      domain, // <<< IMPORTANT: always send as `domain`
      region: els.region?.value || "US/CA",
      radiusMi: Number(els.radius?.value || 50)
      // persona: optional later
    };

    const { status, body } = await api("/api/v1/leads/find-buyers", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (status === 400) {
      toast(body?.error || "Bad request", "error");
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
    if (!Array.isArray(body)) return;
    if (!els.tableBody) return;
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

  // wire events
  loadLocal();
  els.apply?.addEventListener("click", () => { saveLocal(); toast("Applied API base & key.", "info"); });
  els.btnFind?.addEventListener("click", () => findBuyers());
  els.hotBtn?.addEventListener("click", () => refreshList("hot"));
  els.warmBtn?.addEventListener("click", () => refreshList("warm"));

  // initial warm list load
  refreshList("warm").catch(() => {});
})();