// docs/sections/process/process.js
// Section 3 – Process (V2 stepper → docked overview)
// Mounts into <div id="section-process"></div>
(function(){
  const mount = document.getElementById("section-process");
  if (!mount) return;

  // -------- data --------
  const DATA = (window.PROCESS_DATA && typeof window.PROCESS_DATA === "object")
    ? window.PROCESS_DATA
    : {
        title: "How the scoring engine works",
        sub: "We score each lead across four lenses, then surface the fastest wins.",
        columns: [
          { id:"intent",    label:"Intent Score",    emoji:"⚡",
            nodes:[
              {id:"search",emoji:"🔎",label:"Search velocity"},
              {id:"ltv",emoji:"📈",label:"Customer LTV/CAC"},
              {id:"size",emoji:"🏢",label:"Company size"},
              {id:"tech",emoji:"🛠️",label:"Warehouse tech"},
              {id:"tools",emoji:"🧰",label:"Tools interacted"}
            ]},
          { id:"weight",    label:"Weight Score",    emoji:"⚖️",
            nodes:[
              {id:"posting",emoji:"🗞️",label:"Posting behaviour"},
              {id:"goodwill",emoji:"🎁",label:"Offers / lead magnets"},
              {id:"nature",emoji:"🏭",label:"Nature of business"},
              {id:"freq",emoji:"🔁",label:"Purchase frequency"}
            ]},
          { id:"character", label:"Character Score", emoji:"🧠",
            nodes:[
              {id:"reviews",emoji:"⭐",label:"Past reviews"},
              {id:"jumps",emoji:"↔️",label:"Vendor switching"},
              {id:"values",emoji:"💬",label:"Language → values"},
              {id:"culture",emoji:"🌐",label:"Language → culture"}
            ]},
          { id:"platform",  label:"Platform Score",  emoji:"📡",
            nodes:[
              {id:"posts",emoji:"🗂️",label:"# posts / platform"},
              {id:"comments",emoji:"💬",label:"# comments / platform"},
              {id:"reply",emoji:"✉️",label:"Intent to respond"}
            ]}
        ],
        result: {
          title:"Result",
          bullets:[
            "Fastest-to-buy window",
            "Likely retention horizon",
            "Advocacy potential",
            "Best first contact channel"
          ]
        },
        stepsRail: [
          {id:"guard",title:"Score System",body:"We only advance leads that match your persona."},
          {id:"intent",title:"Intent score",body:"How fast they’re likely to buy."},
          {id:"weight",title:"Weight score",body:"How commercially meaningful they are."},
          {id:"character",title:"Character score",body:"How they behave with suppliers & customers."},
          {id:"platform",title:"Platform score",body:"Where they’ll most likely reply first."},
          {id:"result",title:"Result",body:"Prioritised list with the reasoning attached."}
        ]
      };

  // -------- DOM --------
  const dotsCount = DATA.columns.length + 1; // +1 for Result
  const dotsHTML = Array.from({length: dotsCount}, (_,i)=>`<li><button class="dot" data-idx="${i}" aria-label="Step ${i+1}">${i+1}</button></li>`).join("");

  const lanesHTML = DATA.columns.map(col=>`
    <div class="lane" data-col="${col.id}">
      <div class="lane-hd">
        <span class="tag">${col.emoji}</span>
        <span>${col.label}</span>
      </div>
      <div class="chips">
        ${col.nodes.map(n=>`<div class="chip"><span class="ico">${n.emoji}</span><span>${n.label}</span></div>`).join("")}
      </div>
    </div>
  `).join("");

  const notesHTML = DATA.stepsRail.map(s=>`
    <div class="note" data-note="${s.id}">
      <h4>${s.title}</h4>
      <p>${s.body}</p>
    </div>
  `).join("");

  mount.innerHTML = `
  <section class="procV2 mode-intro" aria-label="Process">
    <div class="inner">
      <header class="hd">
        <h2>${DATA.title}</h2>
        <div class="sub">${DATA.sub}</div>
      </header>

      <div class="stage">
        <div class="board" id="pBoard">
          <div class="lanes" id="pLanes">
            ${lanesHTML}
            <div class="result" id="pResult">
              <h4>🎯 ${DATA.result.title}</h4>
              <ul>${DATA.result.bullets.map(b=>`<li>${b}</li>`).join("")}</ul>
            </div>
          </div>
        </div>

        <aside class="rail">
          <div class="sentinel">
            <nav class="stepper" id="pStepper" aria-label="Process steps">
              <ol id="pDots">${dotsHTML}</ol>
              <div class="stepper-ctrls">
                <button class="btn" id="pPrev" type="button" disabled>Prev step</button>
                <button class="btn primary" id="pNext" type="button">Next step</button>
              </div>
            </nav>
            <div class="rail-notes" id="pNotes">${notesHTML}</div>
          </div>
        </aside>
      </div>
    </div>
  </section>`;

  // -------- state & refs --------
  const root   = mount.querySelector(".procV2");
  const dots   = Array.from(mount.querySelectorAll(".dot"));
  const prevBt = mount.querySelector("#pPrev");
  const nextBt = mount.querySelector("#pNext");
  const lanes  = Array.from(mount.querySelectorAll(".lane"));
  const result = mount.querySelector("#pResult");
  const notes  = Array.from(mount.querySelectorAll(".rail-notes .note"));

  // idx: 0..(cols-1) for lanes, cols for result; -1 = intro (no focus)
  let idx = -1;

  function applyFocus(){
    // dots
    dots.forEach((d,i)=>{
      d.classList.toggle("is-active", i===idx);
      d.classList.toggle("is-done", i<idx && idx>=0);
    });

    // lanes/result focus
    lanes.forEach((el,i)=>{
      el.classList.toggle("is-focus", i===idx);
      el.classList.toggle("is-dim", idx>=0 && i!==idx && idx<dotsCount);
    });
    result.classList.toggle("is-focus", idx===dotsCount-1);
    if (idx===dotsCount-1){ lanes.forEach(el=>el.classList.add("is-dim")); }
    if (idx<0){ lanes.forEach(el=>{el.classList.remove("is-dim","is-focus");}); result.classList.remove("is-focus"); }

    // rail notes
    const map = [...DATA.columns.map(c=>c.id), "result"];
    notes.forEach(n=>{
      const target = map[idx] || "guard";
      const show = n.dataset.note === target || (idx<0 && n.dataset.note==="guard");
      n.style.opacity = show ? "1" : ".45";
      n.style.filter  = show ? "none" : "grayscale(.1)";
    });

    // controls
    prevBt.disabled = (idx<=0);
    nextBt.textContent = (idx >= dotsCount-1) ? "Restart" : "Next step";
  }

  function toOverview(startIdx=0){
    if (!root.classList.contains("mode-overview")){
      root.classList.remove("mode-intro");
      root.classList.add("mode-overview");
    }
    idx = Math.max(0, Math.min(dotsCount-1, startIdx));
    applyFocus();
  }

  // -------- events --------
  nextBt.addEventListener("click", ()=>{
    if (idx<0){ toOverview(0); return; }
    if (idx >= dotsCount-1){ // restart to intro
      idx = -1;
      root.classList.remove("mode-overview");
      root.classList.add("mode-intro");
      applyFocus();
      return;
    }
    idx++;
    applyFocus();
  });

  prevBt.addEventListener("click", ()=>{
    if (idx<=0) return;
    idx--;
    applyFocus();
  });

  dots.forEach(d=>d.addEventListener("click",(e)=>{
    const i = parseInt(e.currentTarget.dataset.idx,10);
    if (idx<0) toOverview(i);
    else { idx = i; applyFocus(); }
  }));

  // keyboard: Enter advances; ←/→ move between steps in overview
  mount.addEventListener("keydown",(e)=>{
    if (e.key==="Enter"){ e.preventDefault(); nextBt.click(); }
    if (idx>=0 && (e.key==="ArrowRight"||e.key==="ArrowDown")){
      e.preventDefault(); if (idx<dotsCount-1){ idx++; applyFocus(); }
    }
    if (idx>=0 && (e.key==="ArrowLeft"||e.key==="ArrowUp")){
      e.preventDefault(); if (idx>0){ idx--; applyFocus(); }
    }
  });

  // start in intro (numbers-only)
  applyFocus();
})();