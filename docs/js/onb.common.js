<!-- docs/js/onb.common.js -->
<script>
(function () {
  const qs = new URLSearchParams(location.search);

  function normHost(h) {
    return (h || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "");
  }
  function domainFromEmail(e) {
    const m = (e || "").toLowerCase().match(/@([a-z0-9.-]+)/);
    return m ? m[1] : "";
  }

  function readSeed() {
    // from localStorage
    let seed = {};
    try { seed = JSON.parse(localStorage.getItem("onb.seed") || "{}"); } catch {}
    // query-string overrides
    const qHost = normHost(qs.get("host"));
    const qRole = (qs.get("role") || "").toLowerCase();
    const qEmail = (qs.get("email") || "").trim();
    const qName = (qs.get("name") || "").trim();
    const qPhone = (qs.get("phone") || "").trim();

    const merged = {
      role: qRole || seed.role || "supplier",
      host: qHost || seed.host || "",
      contact: {
        name: qName || (seed.contact && seed.contact.name) || "",
        email: qEmail || (seed.contact && seed.contact.email) || "",
        phone: qPhone || (seed.contact && seed.contact.phone) || "",
      }
    };
    return merged;
  }

  function writeSeed(next) {
    const seed = {
      role: next.role || "supplier",
      host: normHost(next.host || ""),
      contact: {
        name: (next.contact?.name || "").trim(),
        email: (next.contact?.email || "").trim(),
        phone: (next.contact?.phone || "").trim()
      }
    };
    try {
      localStorage.setItem("onb.seed", JSON.stringify(seed));
      if (seed.host) localStorage.setItem("fp.supplier.host", seed.host);
      if (seed.contact.email) localStorage.setItem("email", seed.contact.email);
      localStorage.setItem("contact.name", seed.contact.name || "");
      localStorage.setItem("contact.phone", seed.contact.phone || "");
    } catch {}
    return seed;
  }

  function setRoleUI(role) {
    const sup = document.getElementById("opt-supplier");
    const buy = document.getElementById("opt-buyer");
    sup && sup.classList.toggle("active", role === "supplier");
    buy && buy.classList.toggle("active", role === "buyer");
  }

  function prefillFromSeed(seed) {
    const name = document.getElementById("name");
    const phone = document.getElementById("phone");
    const email = document.getElementById("email");
    const host = document.getElementById("host");
    if (name && seed.contact?.name) name.value = seed.contact.name;
    if (phone && seed.contact?.phone) phone.value = seed.contact.phone;
    if (email && seed.contact?.email) email.value = seed.contact.email;
    if (host && (seed.host || seed.contact?.email)) {
      host.value = seed.host || domainFromEmail(seed.contact.email);
    }
    setRoleUI(seed.role || "supplier");
  }

  function goToStep3(seed, targetHref) {
    const p = new URLSearchParams({
      host: seed.host || "",
      role: seed.role || "supplier",
      email: seed.contact?.email || "",
      name: seed.contact?.name || "",
      phone: seed.contact?.phone || ""
    });
    window.location.href = `${targetHref}?${p.toString()}`;
  }

  window.ONB = {
    normHost, domainFromEmail,
    readSeed, writeSeed,
    setRoleUI, prefillFromSeed, goToStep3
  };
})();
</script>