// docs/sections/process/process.js  (LANES v3)
// Mounts into <div id="section-process"></div>
// Works with process.css (lanes) and optional process.data.js

(function () {
  const mount = document.getElementById("section-process");
  if (!mount) return;

  // ---------------- DATA ----------------
  // Prefer external data file if present; otherwise fallback.
  const D =
    (window.ProcessData && typeof window.ProcessData === "object"
      ? window.ProcessData
      : null) || {
      title: "How the scoring engine works",
      sub: "We score each lead across four lenses, then surface the fastest wins.",
      columns: [
        {
          id: "intent",
          label: "Intent Score",
          emoji: "⚡",
          nodes: [
            { id: "search", emoji: "🔎", label: "Search velocity" },
            { id: "tech", emoji: "🛠️", label: "Warehouse tech" },
            { id: "ltv", emoji: "📈", label: "Customer LTV/CAC" },
            { id: "tools", emoji: "🧰", label: "Tools interacted" },
            { id: "size", emoji: "🏢", label: "Company size" }
          ]
        },
        {
          id: "weight",
          label: "Weight Score",
          emoji: "⚖️",
          nodes: [
            { id: "posting", emoji: "🗞️", label: "Posting behaviour" },
            { id: "goodwill", emoji: "🎁", label: "Offers / lead magnets" },
            { id: "nature", emoji: "🏭", label: "Nature of business" },
            { id: "freq", emoji: "🔁", label: "Purchase frequency" }
          ]
        },
        {
          id: "character",
          label: "Character Score",
          emoji: "🧠",
          nodes: [
            { id: "reviews", emoji: "⭐", label: "Past reviews" },
            { id: "jumps", emoji: "↔️", label: "Vendor switching" },
            { id: "values", emoji: "💬", label: "Language → values" },
            { id: "culture", emoji: "🌐", label: "Language → culture" }
          ]
        },
        {
          id: "platform",
          label: "Platform Score",
          emoji: "📡",
          nodes: [
            { id: "posts", emoji: "🗂️", label: "# posts / platform" },
            { id: "comments", emoji: "💬", label: "# comments / platform" },
            { id: "reply", emoji: "✉️", label: "Intent to respond" }
          ]
        }
      ],
      result: {
        title: "Result",
        bullets: [
          "Fastest-to-buy window",
          "Likely retention horizon",
          "Advocacy potential",
          "Best first contact channel"
        ]
      },
      steps: [
        {
          id: "intro",
          title: "Score System",
          body: "We only advance leads that match your persona."
        },
        { id: "intent", title: "Intent score", body: "How fast they’re likely to buy." },
        {
          id: "weight",
          title: "Weight score",
          body: "How commercially meaningful they are."
        },
        {
          id: "character",
          title: "Character score",
          body: "How they behave with suppliers & customers."
        },
        {
          id: "platform",
          title: "Platform score",
          body: "Where they’ll most likely reply first."
        },
        {
          id: "result",
          title: "Result",
          body: "Prioritised list with the reasoning attached."
        }
      ]
    };

  // ---------------- DOM ----------------
  // section root
  const railStepsHTML = D.steps
    .map(
      (s) => `
      <div class="proc-step" data-step="${s.id}">
        <div class="proc-bullet"></div>
        <h3>${s.title}</h3>
        <p>${s.body}</p>
      </div>`
    )
    .join("");

  mount.innerHTML = `
  <section class="proc-section proc-lanes" aria-label="Process">
    <div class="proc-inner">
      <header class="proc-hd">
        <h2>${D.title}</h2>
        <div class="sub">${D.sub}</div>
      </header>

      <div class="lanes-board" id="procBoard">
        <div class="lanes-head">
          ${D.columns
            .map(
              (c) =>
                `<button class="chip lens-tag" data-jump="${c.id}" aria-label="${c.label}">
                  <span class="ico">${c.emoji}</span>${c.label}
                </button>`
            )
            .join("")}
        </div>

        ${D.columns
          .map(
            (c) => `
          <div class="lane" data-lane="${c.id}">
            ${c.nodes
              .map(
                (n) => `
              <button class="chip" data-jump="${c.id}" data-node="${n.id}">
                <span class="ico">${n.emoji}</span>${n.label}
              </button>`
              )
              .join("")}
          </div>`
          )
          .join("")}

        <div class="lane" data-lane="result">
          <div class="chip" aria-hidden="true" style="opacity:.6">
            🎯 ${D.result.title}
          </div>
        </div>
      </div>

      <aside class="proc-rail" id="procRail">
        <div class="proc-progress" id="procProg"></div>
        ${railStepsHTML}
      </aside>
    </div>
  </section>`;

  const rail = mount.querySelector("#procRail");
  const prog = mount.querySelector("#procProg");
  const stepEls = Array.from(mount.querySelectorAll(".proc-step"));
  const stepById = Object.fromEntries(stepEls.map((el) => [el.dataset.step, el]));
  const lanes = Object.fromEntries(
    Array.from(mount.querySelectorAll(".lane")).map((el) => [el.dataset.lane, el])
  );

  // ---------------- BEHAVIOR ----------------
  function setActive(stepId) {
    const order = D.steps.map((s) => s.id);
    const idx = Math.max(0, order.indexOf(stepId));

    // right-rail state
    stepEls.forEach((el, i) => {
      el.classList.toggle("is-current", i === idx);
      el.classList.toggle("is-done", i < idx);
    });

    // left lanes highlight
    ["intent", "weight", "character", "platform"].forEach((k) => {
      if (lanes[k]) lanes[k].classList.toggle("is-active", k === stepId);
      else if (lanes[k]) lanes[k].classList.remove("is-active");
    });

    // progress bar height (simple proportional)
    const r = rail.getBoundingClientRect();
    const h = r.height;
    const t = Math.max(0, Math.min(1, idx / (order.length - 1)));
    prog.style.height = Math.round(t * h) + "px";
  }

  // IO to drive state by scroll
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const id = e.target.dataset.step || "intro";
        setActive(id);
      });
    },
    { threshold: 0.55 }
  );
  stepEls.forEach((el) => io.observe(el));

  // click any chip or lens tag → scroll to that step in rail
  mount.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-jump]");
    if (!btn) return;
    const id = btn.getAttribute("data-jump");
    const t = stepById[id];
    if (t) t.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  // initial state
  setActive("intent");

  // keep progress in sync on resize
  addEventListener("resize", () => {
    const current = stepEls.find((el) => el.classList.contains("is-current"));
    setActive(current ? current.dataset.step : "intent");
  });
})();