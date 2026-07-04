// Shared shell + shared primitives. Every module renders through these —
(function () {
  const S = {};
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  S.esc = esc;

  S.el = (id) => document.getElementById(id);
  S.regions = () => ({
    search: S.el("regionSearch"),
    results: S.el("regionResults"),
    analysis: S.el("regionAnalysis")
  });

  // ---------- badges (shared vocabulary for Availability / Confidence / status) ----------
  const BADGE_CLASS = {
    CONFIRMED: "b-ok", ALLOWED: "b-ok", ACTIVE: "b-active", READABLE: "b-ok",
    LIKELY: "b-warn", "READ ONLY": "b-warn", PARTIAL: "b-warn", UNKNOWN: "b-warn",
    UNAVAILABLE: "b-bad", DENIED: "b-bad", BLOCKED: "b-bad", INACTIVE: "b-mute",
    "NEEDS RECORD": "b-mute", "METADATA API": "b-warn"
  };
  S.badge = (text, cls) => {
    if (String(text).toUpperCase() === "CONFIRMED") return "";
    return '<span class="badge ' + (cls || BADGE_CLASS[String(text).toUpperCase()] || "b-mute") + '">' + esc(text) + "</span>";
  };
  S.typeBadge = (t) => '<span class="badge b-type">' + esc(t) + "</span>";

  S.spinner = (msg) => '<div class="loading-line"><span class="spinner"></span>' + esc(msg || "Loading…") + "</div>";
  S.error = (msg) => '<div class="err">' + esc(msg) + "</div>";
  S.toast = (msg) => {
    const t = S.el("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(t._h); t._h = setTimeout(() => (t.hidden = true), 3200);
  };

  // ---------- stat cards ----------
  S.statCards = (items) =>
    '<div class="cards">' + items.map((i) =>
      '<div class="stat"><div class="k">' + esc(i.k) + '</div><div class="v">' + i.v + "</div>" +
      (i.s ? '<div class="s">' + i.s + "</div>" : "") + "</div>").join("") + "</div>";

  S.analysisHead = (title, rightHtml) =>
    '<div class="analysis-head"><span class="analysis-eyebrow">Analysis</span>' +
    '<span class="analysis-title">' + title + '</span><span class="spacer"></span>' + (rightHtml || "") + "</div>";

  S.sectionLabel = (t) => '<div class="section-label">' + esc(t) + "</div>";

  // ---------- coverage / related bottom grid ----------
  S.bottomGrid = (coverageHtml, relatedChips) =>
    '<div class="bottom-grid single"><div class="panel"><h4>Related</h4><div class="chips">' +
    relatedChips.map((c) => '<button class="chip" data-goto="' + esc(c.mod) + '">' + esc(c.label) + "</button>").join("") +
    "</div></div></div>";

  S.meter = (label, pct) =>
    '<div class="meter-row"><span style="min-width:140px">' + esc(label) + '</span><span class="meter"><i style="width:' +
    Math.max(0, Math.min(100, pct)) + '%"></i></span><b style="min-width:42px;text-align:right">' + pct + "%</b></div>";

  // ---------- results table with client-side pagination ----------
  S.resultsTable = (container, cfg) => {
    const state = { page: 1, size: cfg.pageSize || 10 };
    function render() {
      const total = cfg.rows.length;
      const pages = Math.max(1, Math.ceil(total / state.size));
      state.page = Math.min(state.page, pages);
      const start = (state.page - 1) * state.size;
      const slice = cfg.rows.slice(start, start + state.size);

      const pager = [];
      pager.push('<button data-pg="prev" ' + (state.page === 1 ? "disabled" : "") + ">‹ Prev</button>");
      const windowPages = [];
      for (let p = 1; p <= pages; p++) {
        if (p <= 2 || p > pages - 1 || Math.abs(p - state.page) <= 1) windowPages.push(p);
      }
      let last = 0;
      for (const p of windowPages) {
        if (p - last > 1) pager.push("<span>…</span>");
        pager.push('<button data-pg="' + p + '" class="' + (p === state.page ? "cur" : "") + '">' + p + "</button>");
        last = p;
      }
      pager.push('<button data-pg="next" ' + (state.page === pages ? "disabled" : "") + ">Next ›</button>");

      container.innerHTML =
        '<div class="results-meta"><span>' + esc(cfg.countLabel || total + " results") + "</span>" +
        '<select class="pgsize">' + [10, 25, 50, 100].map((n) =>
          '<option value="' + n + '"' + (n === state.size ? " selected" : "") + ">" + n + "</option>").join("") + "</select>" +
        '<span class="spacer"></span><span class="pager">' + pager.join("") + "</span></div>" +
        '<div class="card"><table class="grid"><thead><tr>' +
        cfg.columns.map((c) => "<th class=\"" + (c.cls || "") + "\">" + esc(c.h) + "</th>").join("") +
        "</tr></thead><tbody>" +
        (slice.length ? slice.map((r, i) =>
          '<tr class="' + (r.onClick ? "rowable " : "") + (r.selected ? "selrow " : "") + (r.cls || "") + '" data-row="' + (start + i) + '">' +
          r.cells.map((c, j) => "<td class=\"" + ((cfg.columns[j] && cfg.columns[j].cls) || "") + "\">" + c + "</td>").join("") +
          "</tr>").join("")
          : '<tr><td colspan="' + cfg.columns.length + '" class="empty">' + esc(cfg.emptyText || "No results.") + "</td></tr>") +
        "</tbody></table></div>";

      container.querySelector(".pgsize").addEventListener("change", (e) => { state.size = +e.target.value; state.page = 1; render(); });
      container.querySelectorAll("[data-pg]").forEach((b) => b.addEventListener("click", () => {
        const v = b.getAttribute("data-pg");
        if (v === "prev") state.page--; else if (v === "next") state.page++; else state.page = +v;
        render();
      }));
      container.querySelectorAll("tr.rowable").forEach((tr) => tr.addEventListener("click", (ev) => {
        if (ev.target.closest("a")) return;
        const row = cfg.rows[+tr.getAttribute("data-row")];
        if (row && row.onClick) row.onClick();
      }));
    }
    render();
  };

  // ---------- typeahead search row ----------
  S.searchRow = (container, cfg) => {
    const selHtml = (cfg.selects || []).map((s) =>
      '<div class="select"><select id="' + esc(s.id) + '" aria-label="' + esc(s.label || s.id) + '">' +
      s.options.map((o) => '<option value="' + esc(o.v) + '"' + (o.v === s.value ? " selected" : "") + ">" + esc(o.t) + "</option>").join("") +
      "</select></div>").join("");
    container.innerHTML =
      '<div class="search-row">' + selHtml +
      '<div class="search-box"><input id="shellSearch" type="text" autocomplete="off" placeholder="' + esc(cfg.placeholder || "Search…") + '">' +
      '<div class="suggest" id="shellSuggest" hidden></div></div>' +
      '<button class="primary-btn" id="shellGo">' + esc(cfg.buttonLabel || "Analyze") + "</button></div>";

    const input = container.querySelector("#shellSearch");
    const sug = container.querySelector("#shellSuggest");
    const go = container.querySelector("#shellGo");
    let items = [], selIdx = -1, seq = 0, timer, locked = false;

    function renderSug() {
      if (!items.length) { sug.hidden = true; return; }
      sug.innerHTML = '<div class="suggest-list">' + items.map((it, i) =>
        '<div class="suggest-item' + (i === selIdx ? " sel" : "") + '" data-i="' + i + '">' +
        '<div class="suggest-name">' + it.nameHtml + "</div>" +
        '<div class="suggest-meta">' + (it.badge ? S.typeBadge(it.badge) : "") + "<span>" + esc(it.meta || "") + "</span></div></div>").join("") + "</div>" +
        "";
      sug.hidden = false;
      const sel = sug.querySelector(".suggest-item.sel");
      if (sel) sel.scrollIntoView({ block: "nearest" });
      sug.querySelectorAll(".suggest-item").forEach((n) =>
        n.addEventListener("mousedown", (e) => { e.preventDefault(); pick(+n.getAttribute("data-i")); }));
    }
    function pick(i) {
      const it = items[i];
      locked = true; clearTimeout(timer); seq++; sug.hidden = true; sug.innerHTML = ""; items = [];
      if (it) { input.value = it.plain || ""; input.blur(); it.onPick(); }
    }
    function hi(name, term) {
      const idx = name.toLowerCase().indexOf(term.toLowerCase());
      if (idx < 0 || !term) return esc(name);
      return esc(name.slice(0, idx)) + "<mark>" + esc(name.slice(idx, idx + term.length)) + "</mark>" + esc(name.slice(idx + term.length));
    }
    S._hi = hi;

    input.addEventListener("input", () => {
      locked = false;
      clearTimeout(timer);
      const term = input.value.trim();
      if (cfg.onTermChange) cfg.onTermChange(term);
      if (term.length < 2) { items = []; sug.hidden = true; return; }
      timer = setTimeout(async () => {
        if (locked || document.activeElement !== input) return;
        const my = ++seq;
        sug.hidden = false;
        sug.innerHTML = '<div class="suggest-empty"><span class="spinner"></span>Searching all metadata…</div>';
        try {
          const res = await cfg.fetchSuggestions(term);
          if (my !== seq || locked) { sug.hidden = true; return; }
          items = (res || []).map((r) => ({
            nameHtml: r.nameHtml || hi(r.name, term), plain: r.name, badge: r.badge, meta: r.meta, onPick: r.onPick
          }));
          selIdx = -1;
          if (!items.length) { sug.innerHTML = '<div class="suggest-empty">No matches in this org.</div>'; return; }
          renderSug();
        } catch (e) {
          if (my !== seq) return;
          sug.innerHTML = '<div class="suggest-empty">' + esc(e.message) + "</div>";
        }
      }, 300);
    });
    input.addEventListener("keydown", (e) => {
      if (sug.hidden) { if (e.key === "Enter") cfg.onSubmit && cfg.onSubmit(input.value.trim()); return; }
      if (e.key === "ArrowDown") { selIdx = Math.min(items.length - 1, selIdx + 1); renderSug(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { selIdx = Math.max(0, selIdx - 1); renderSug(); e.preventDefault(); }
      else if (e.key === "Enter") { if (selIdx >= 0) pick(selIdx); else cfg.onSubmit && cfg.onSubmit(input.value.trim()); e.preventDefault(); }
      else if (e.key === "Escape") { sug.hidden = true; }
    });
    input.addEventListener("blur", () => setTimeout(() => (sug.hidden = true), 150));
    go.addEventListener("click", () => { if (go.disabled) return; locked = true; clearTimeout(timer); seq++; sug.hidden = true; items = []; cfg.onSubmit && cfg.onSubmit(input.value.trim()); });

    return {
      input,
      selectValue: (id) => { const n = container.querySelector("#" + id); return n ? n.value : null; },
      onSelectChange: (id, fn) => { const n = container.querySelector("#" + id); if (n) n.addEventListener("change", () => fn(n.value)); },
      hide: () => { locked = true; clearTimeout(timer); seq++; sug.hidden = true; sug.innerHTML = ""; items = []; },
      setEnabled: (v) => { go.disabled = !v; },
      setValue: (v) => { input.value = v; }
    };
  };

  // ---------- layers / phases ----------
  S.layer = (l) =>
    '<div class="layer' + (l.dim ? " dim" : "") + '"><div class="layer-head"><span class="lnum">' + esc(l.num) + "</span>" +
    '<span class="layer-title">' + esc(l.title) + '</span><span class="spacer"></span>' + (l.statusBadge || "") + "</div>" +
    (l.bodyHtml ? '<div class="layer-body">' + l.bodyHtml + "</div>" : "") + "</div>";

  // ---------- module registry ----------
  S.modules = {};
  S.register = (name, mod) => { S.modules[name] = mod; };
  S.activate = (name, params) => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.mod === name));
    const r = S.regions();
    r.search.innerHTML = ""; r.results.innerHTML = ""; r.analysis.innerHTML = "";
    S.current = name;
    S.modules[name].mount(r, params || {});
    document.body.addEventListener("click", S._chipHandler || (S._chipHandler = (e) => {
      const chip = e.target.closest("[data-goto]");
      if (chip) {
        const [mod] = chip.getAttribute("data-goto").split("?");
        S.activate(mod, S.handoff || {});
      }
    }), { once: false });
  };
  // context handoff between modules (deep links across tabs)
  S.handoff = {};

  window.Shell = S;
})();
