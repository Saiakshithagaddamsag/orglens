// MODULE 2 — Flow Analyzer. Question: "What does this flow do?"
(function () {
  const mod = {};
  const esc = (s) => Shell.esc(s);

  mod.mount = (regions, params) => {
    let docMode = "business";
    let currentFlow = null;
    let lastByName = null;
    const row = Shell.searchRow(regions.search, {
      selects: [
        { id: "flStatus", label: "Status", options: [{ v: "active", t: "Active" }, { v: "all", t: "All" }], value: "active" },
        { id: "flSort", label: "Sort", options: [{ v: "active", t: "Active" }, { v: "az", t: "A–Z" }, { v: "mod", t: "Last Modified" }], value: "active" }
      ],
      placeholder: "Search flows by name…",
      buttonLabel: "Generate",
      footNote: "Searches all standard + custom in the " + (OrgAPI.isSandbox() ? "sandbox" : "org") + " · no result limit",
      fetchSuggestions: async (term) => {
        const flows = await searchFlows(term);
        return flows.map((f) => ({
          name: f.Label || f.ApiName, badge: "FLOW",
          meta: MetaSearch.flowTypeLabel(f) + (f.IsActive ? " · Active" : " · Inactive"),
          onPick: () => {
            currentFlow = f;
            row.setEnabled(true);
            listSelected(f);
            regions.analysis.innerHTML = '<div class="note" style="font-size:14px">Selected <b>' + esc(f.Label || f.ApiName) + "</b> — click <b>Generate</b> to document it.</div>";
          }
        }));
      },
      onSubmit: (term) => {
        if (currentFlow) analyze(currentFlow);
        else listFlows(term);
      },
      onTermChange: (term) => {
        if (currentFlow && term !== (currentFlow.Label || currentFlow.ApiName)) {
          currentFlow = null;
          row.setEnabled(false);
        }
      }
    });
    row.setEnabled(false);
    row.onSelectChange("flStatus", () => listFlows(lastTerm));
    row.onSelectChange("flSort", () => listFlows(lastTerm));
    let lastTerm = "";

    const FSEL = "SELECT DurableId, ApiName, Label, ProcessType, TriggerType, RecordTriggerType, TriggerObjectOrEventLabel, IsActive, ActiveVersionId, LatestVersionId, LastModifiedDate FROM FlowDefinitionView";

    async function searchFlows(term) {
      const t = OrgAPI.escLike(term || "");
      const act = row.selectValue("flStatus") === "active" ? "IsActive = true" : null;
      // FlowDefinitionView rejects OR ("Disjunctions not supported") — one
      const w = (cond) => FSEL + " WHERE " + [cond, act].filter(Boolean).join(" AND ");
      const recs = t
        ? await OrgAPI.queryUnion([w("Label LIKE '%" + t + "%'"), w("ApiName LIKE '%" + t + "%'")], (f) => f.DurableId)
        : (await OrgAPI.query(act ? FSEL + " WHERE " + act : FSEL)).records;
      const sort = row.selectValue("flSort");
      recs.sort((a, b) =>
        sort === "mod" ? String(b.LastModifiedDate || "").localeCompare(String(a.LastModifiedDate || "")) :
        sort === "az" ? String(a.Label || a.ApiName).localeCompare(String(b.Label || b.ApiName)) :
        (Number(b.IsActive) - Number(a.IsActive)) || String(a.Label || a.ApiName).localeCompare(String(b.Label || b.ApiName)));
      return recs;
    }

    function listSelected(f) {
      Shell.resultsTable(regions.results, {
        countLabel: "1 flow — selected",
        columns: [{ h: "Flow name", cls: "tname" }, { h: "Type" }, { h: "Trigger object" }, { h: "Status" }, { h: "Last modified" }, { h: "", cls: "right" }],
        rows: [{
          selected: true,
          cells: [esc(f.Label || f.ApiName),
            esc(f.ProcessType === "Flow" ? "Screen Flow" : "Triggered Flow"),
            esc(f.TriggerObjectOrEventLabel || "—"),
            f.IsActive ? Shell.badge("Active", "b-active") : Shell.badge("Inactive"),
            esc((f.LastModifiedDate || "").slice(0, 10)),
            Links.open(Links.flowVersion(f.ActiveVersionId || f.LatestVersionId))],
          onClick: () => analyze(f)
        }]
      });
    }

    async function listFlows(term) {
      lastTerm = term || "";
      regions.results.innerHTML = Shell.spinner("Listing flows — full org, no limit…");
      try {
        const flows = await searchFlows(term);
        Shell.resultsTable(regions.results, {
          countLabel: flows.length + " flows",
          columns: [{ h: "Flow name", cls: "tname" }, { h: "Type" }, { h: "Trigger object" }, { h: "Status" }, { h: "Last modified" }, { h: "", cls: "right" }],
          rows: flows.map((f) => ({
            cells: [esc(f.Label || f.ApiName),
              esc(f.ProcessType === "Flow" ? "Screen Flow" : "Triggered Flow"),
              esc(f.TriggerObjectOrEventLabel || "—"),
              f.IsActive ? Shell.badge("Active", "b-active") : Shell.badge("Inactive"),
              esc((f.LastModifiedDate || "").slice(0, 10)),
              Links.open(Links.flowVersion(f.ActiveVersionId || f.LatestVersionId))],
            onClick: () => analyze(f)
          }))
        });
      } catch (e) { regions.results.innerHTML = Shell.error(e.message); }
    }

    // Deterministic plain-English overview — assembled only from facts already
    function narrative(meta, io, f) {
      const s = [];
      const start = meta.start || {};
      if (f.ProcessType === "Flow") s.push("This flow is started by a person — it walks them through " + (meta.screens || []).length + " screen(s).");
      else if (start.triggerType === "RecordAfterSave" || start.triggerType === "RecordBeforeSave")
        s.push("This flow runs automatically " + (start.triggerType === "RecordBeforeSave" ? "just before" : "right after") + " a " + (start.object || "record") + " is " +
          ({ Create: "created", Update: "updated", CreateAndUpdate: "created or updated", Delete: "deleted" }[start.recordTriggerType] || "saved") +
          (start.filterFormula || (start.filters || []).length ? ", but only when its entry condition matches" : "") + ".");
      else if (start.triggerType === "Scheduled") s.push("This flow runs on a schedule, not when someone edits a record.");
      else s.push("This flow is started by another automation or by code, not directly by a person.");
      const nDec = (meta.decisions || []).length;
      if (nDec) s.push("It makes " + nDec + " decision(s), so what happens depends on the record at the time.");
      const w = io.writes;
      const fieldsWritten = w.filter((x) => x.group === "Record fields written").length;
      const creates = w.filter((x) => x.group === "Records created").length;
      const deletes = w.filter((x) => x.group === "Records deleted").length;
      const viaSub = w.filter((x) => x.group.startsWith("Via subflow")).length;
      const apex = w.filter((x) => x.group === "Apex actions").length;
      const emails = w.filter((x) => x.group === "Emails sent").length;
      const does = [];
      if (fieldsWritten) does.push("changes " + fieldsWritten + " field value(s) on records");
      if (creates) does.push("creates " + creates + " new record(s)");
      if (deletes) does.push("deletes record(s)");
      if (viaSub) does.push("does more work through " + (meta.subflows || []).length + " other flow(s)");
      if (emails) does.push("sends " + emails + " email(s)");
      if (apex) does.push("runs custom code whose effects are not visible here");
      s.push(does.length ? "Along the way it " + does.join(", ") + "." : "It does not change, create, or delete any records itself.");
      return '<div class="verdict"><div class="verdict-line"><b>In short</b></div><div class="verdict-sub">' + s.map(esc).join(" ") + "</div></div>";
    }

    function downloadWord(f) {
      const area = regions.analysis.cloneNode(true);
      const tb = area.querySelector(".doc-toolbar"); if (tb) tb.remove();
      const title = (f.Label || f.ApiName) + " — Flow Documentation (" + (docMode === "business" ? "Business" : "Technical") + ")";
      const css = "body{font-family:'Segoe UI',Arial,sans-serif;font-size:11pt;color:#2b2826}" +
        "h1{font-size:18pt;color:#16325c}h2{font-size:13pt;color:#16325c;margin-top:18pt}" +
        "table{border-collapse:collapse;width:100%;margin:6pt 0}td,th{border:1px solid #d3dae3;padding:4pt 8pt;font-size:10pt;text-align:left;vertical-align:top}" +
        "th{background:#eef2f7;color:#5f6b7a}" +
        ".pill-code,.mono{font-family:Consolas,monospace;font-size:9.5pt;background:#eaf2fd;padding:1pt 4pt}" +
        ".pill-warn{font-family:Consolas,monospace;font-size:9.5pt;background:#fdf3e1;color:#b26a00;padding:1pt 4pt}" +
        ".badge{font-size:8pt;font-weight:bold;padding:1pt 5pt;border:1px solid #d3dae3}" +
        ".muted{color:#6b7785}.section-label{font-size:9pt;letter-spacing:1pt;color:#6b7785;font-weight:bold;margin-top:16pt}" +
        "svg{max-width:100%}";
      const doc = "<html xmlns:w='urn:schemas-microsoft-com:office:word'><head><meta charset='utf-8'>" +
        "<title>" + esc(title) + "</title><style>" + css + "</style></head><body>" +
        "<h1>" + esc(title) + "</h1>" +
        "<p class='muted'>Generated by Orglens · " + esc(OrgAPI.host()) + " · " + new Date().toISOString().slice(0, 10) +
        " · Read-only documentation — gaps are stated, never guessed.</p>" +
        area.innerHTML + "</body></html>";
      const blob = new Blob(["\ufeff", doc], { type: "application/msword" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (f.ApiName || "flow") + "_" + docMode + "_documentation.doc";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      Shell.toast("Word document downloaded — " + (docMode === "business" ? "business" : "technical") + " version.");
    }

    // ---------------- flow metadata parsing ----------------
    async function fetchFlowMeta(versionId) {
      return OrgAPI.cached("flowmeta:" + versionId, async () => {
        const rec = await OrgAPI.toolingGet("/sobjects/Flow/" + versionId);
        return rec.Metadata;
      });
    }

    const EL_GROUPS = [
      ["decisions", "DECISION"], ["assignments", "ASSIGNMENT"], ["recordCreates", "CREATE RECORDS"],
      ["recordUpdates", "UPDATE RECORDS"], ["recordDeletes", "DELETE RECORDS"], ["recordLookups", "GET RECORDS"],
      ["loops", "LOOP"], ["screens", "SCREEN"], ["subflows", "SUBFLOW"], ["actionCalls", "ACTION"],
      ["waits", "WAIT"], ["collectionProcessors", "COLLECTION"], ["transforms", "TRANSFORM"],
      ["customErrors", "CUSTOM ERROR"], ["apexPluginCalls", "APEX PLUGIN"]
    ];

    function indexElements(meta) {
      const byName = new Map();
      for (const [key, kind] of EL_GROUPS)
        for (const el of meta[key] || []) byName.set(el.name, { kind, key, el });
      return byName;
    }
    const conn = (c) => (c && c.targetReference) || null;

    function refsOfString(s, set) {
      const re = /\$Record\.([A-Za-z0-9_.]+)/g; let m;
      while ((m = re.exec(String(s || "")))) set.add("$Record." + m[1]);
    }
    function deepScan(obj, set) {
      if (obj == null) return;
      if (typeof obj === "string") {
        refsOfString(obj, set);
        if (obj.startsWith("$Record.")) set.add(obj);
        return;
      }
      if (Array.isArray(obj)) return obj.forEach((o) => deepScan(o, set));
      if (typeof obj === "object") Object.values(obj).forEach((v) => deepScan(v, set));
    }

    // Comprehensive I/O inventory: main flow + subflows + Apex + email alerts
    function summarizeIO(meta, subBoxes) {
      const reads = [], writes = [];
      const R = (group, item, note, warn) => reads.push({ group, item, note: note || "", warn });
      const W = (group, item, note, warn) => writes.push({ group, item, note: note || "", warn });
      const start = meta.start || {};

      // --- main flow: record fields read ---
      const recReads = new Map();
      const mark = (tok, where) => { if (!recReads.has(tok)) recReads.set(tok, []); if (!recReads.get(tok).includes(where)) recReads.get(tok).push(where); };
      for (const f of start.filters || []) if (f.field) mark("$Record." + f.field, "entry");
      const eSet = new Set(); deepScan(start.filterFormula, eSet); eSet.forEach((t) => mark(t, "entry"));
      for (const d of meta.decisions || []) { const s = new Set(); deepScan(d.rules, s); s.forEach((t) => mark(t, "decision")); }
      for (const a of meta.assignments || []) { const s = new Set(); deepScan(a.assignmentItems, s); s.forEach((t) => mark(t, "assignment")); }
      for (const u of meta.recordUpdates || []) { const s = new Set(); deepScan(u.filters, s); s.forEach((t) => mark(t, "update filter")); }
      for (const sf of meta.subflows || []) { const s = new Set(); deepScan(sf.inputAssignments, s); s.forEach((t) => mark(t, "to subflow")); }
      for (const ac of meta.actionCalls || []) { const s = new Set(); deepScan(ac.inputParameters, s); s.forEach((t) => mark(t, "to " + (ac.actionType === "apex" ? "Apex" : "action"))); }
      for (const [tok, wheres] of recReads) R("Record fields", tok, wheres.join(" + "));

      for (const g of meta.recordLookups || [])
        R("Records looked up", (g.object || "record") + " — “" + (g.label || g.name) + "”",
          (g.filters && g.filters.length ? g.filters.length + " filter(s)" : "no filters") +
          (g.queriedFields && g.queriedFields.length ? " · fields: " + g.queriedFields.join(", ") : ""));

      // --- main flow: user input via screens + LWC/Aura components ---
      const scanScreenFields = (fields, screenLabel) => {
        for (const fl of fields || []) {
          if (fl.fieldType === "ComponentInstance" || fl.extensionName)
            R("Screen components (LWC/Aura)", (fl.extensionName || fl.name) + " — on “" + screenLabel + "”",
              "custom component — what it reads/collects lives in its own code, not in flow metadata", true);
          else if (fl.fieldType && fl.fieldType !== "DisplayText" && fl.fieldType !== "RegionContainer" && fl.fieldType !== "Region")
            R("User input (screens)", (fl.fieldText || fl.name) + " — on “" + screenLabel + "”", fl.dataType || fl.fieldType || "");
          if (fl.fields && fl.fields.length) scanScreenFields(fl.fields, screenLabel);
        }
      };
      for (const sc of meta.screens || []) scanScreenFields(sc.fields, sc.label || sc.name);

      for (const v of (meta.variables || []).filter((v) => v.isInput))
        R("Flow inputs", v.name, (v.dataType || "") + (v.objectType ? " · " + v.objectType : ""));

      for (const u of meta.recordUpdates || []) {
        const tgt = u.inputReference === "$Record" || !u.object ? "$Record" : u.object;
        for (const ia of u.inputAssignments || [])
          W("Record fields written", tgt + "." + ia.field + " = " + valOf(ia.value), "Update: “" + (u.label || u.name) + "”");
        if (!(u.inputAssignments || []).length)
          W("Record fields written", tgt + " (fields from variable)", "Update: “" + (u.label || u.name) + "” writes whatever the referenced variable holds");
      }
      for (const c of meta.recordCreates || [])
        W("Records created", "New " + (c.object || "record"),
          (c.inputAssignments && c.inputAssignments.length ? "fields: " + c.inputAssignments.map((a) => a.field).join(", ") : "from variable") + " · “" + (c.label || c.name) + "”");
      for (const dl of meta.recordDeletes || [])
        W("Records deleted", (dl.object || "$Record"), "“" + (dl.label || dl.name) + "”");

      for (const sf of meta.subflows || []) {
        const box = subBoxes && subBoxes[sf.name];
        const label = sf.flowName || sf.name;
        if (box && box.meta) {
          const sm = box.meta;
          for (const u of sm.recordUpdates || []) for (const ia of u.inputAssignments || [])
            W("Via subflow “" + label + "”", (u.inputReference === "$Record" || !u.object ? "" : u.object + ".") + ia.field + " = " + valOf(ia.value), "read from the called flow");
          for (const c of sm.recordCreates || [])
            W("Via subflow “" + label + "”", "New " + (c.object || "record"), "read from the called flow");
          for (const dl of sm.recordDeletes || [])
            W("Via subflow “" + label + "”", "Delete " + (dl.object || "record"), "read from the called flow");
          for (const g of sm.recordLookups || [])
            R("Via subflow “" + label + "”", (g.object || "record") + " — “" + (g.label || g.name) + "”", "read from the called flow");
          if ((sm.actionCalls || []).some((a) => a.actionType === "apex"))
            W("Via subflow “" + label + "”", "Apex inside the subflow", "effects unknown — inside the class", true);
        } else {
          W("Via subflow “" + label + "”", "not readable from this session", "the called flow could not be opened — its reads/writes are UNAVAILABLE, not assumed", true);
        }
      }

      for (const ac of meta.actionCalls || []) {
        if (ac.actionType === "apex")
          W("Apex actions", (ac.actionName || ac.name), "reads/writes unknown — they live inside the class, not in flow metadata", true);
        else if (ac.actionType === "emailAlert")
          W("Emails sent", (ac.actionName || ac.name), "recipients/template are in Setup (Metadata API) — use the Open link on the element", true);
        else if (ac.actionType === "emailSimple")
          W("Emails sent", (ac.label || ac.name), "sends an email composed in the flow");
        else
          W("Other actions", (ac.actionName || ac.name) + " (" + (ac.actionType || "action") + ")", "external effect — not statically readable", true);
      }
      return { reads, writes };
    }
    function valOf(v) {
      if (!v) return "";
      if (v.stringValue != null) return '"' + v.stringValue + '"';
      if (v.numberValue != null) return String(v.numberValue);
      if (v.booleanValue != null) return String(v.booleanValue);
      if (v.elementReference) return v.elementReference;
      if (v.dateValue) return v.dateValue;
      return "";
    }

    // Walk elements from start in connector order; branches under decisions.
    function walk(meta) {
      const byName = indexElements(meta);
      const out = []; const seen = new Set();
      function visit(name, depth, branch) {
        while (name && !seen.has(name)) {
          const node = byName.get(name);
          if (!node) return;
          seen.add(name);
          out.push({ name, depth, branch, ...node });
          const el = node.el;
          if (node.kind === "DECISION") {
            for (const rule of el.rules || []) {
              out.push({ isBranchLabel: true, label: rule.label || rule.name, cond: condText(rule), rule, depth: depth });
              visit(conn(rule.connector), depth + 1, rule.label);
            }
            out.push({ isBranchLabel: true, label: el.defaultConnectorLabel || "Default", cond: "", depth });
            visit(conn(el.defaultConnector), depth + 1, "Default");
            return;
          }
          if (node.kind === "LOOP") {
            visit(conn(el.nextValueConnector), depth + 1, "each item");
            name = conn(el.noMoreValuesConnector);
            continue;
          }
          name = conn(el.connector) || conn(el.faultConnector);
        }
      }
      visit(conn((meta.start || {}).connector) || (meta.startElementReference || null), 0, null);
      for (const [n, node] of byName) if (!seen.has(n)) out.push({ name: n, depth: 0, branch: null, orphan: true, ...node });
      return { out, byName };
    }
    // Deterministic humanizing: strips API suffixes/underscores only. The exact
    function humanName(s) {
      s = String(s == null ? "" : s);
      s = s.replace(/^\$Record\./, "");
      const parts = s.split(".");
      s = parts[parts.length - 1];
      s = s.replace(/__(c|r|e)$/i, "").replace(/__mdt$/i, " settings");
      const m = s.match(/^.+?__(.+)$/); if (m) s = m[1];
      s = s.replace(/_/g, " ").replace(/\s+/g, " ").trim();
      return s.replace(/\s+Var$/i, "");
    }
    function humanVal(v) {
      v = String(v == null ? "" : v);
      if (v.startsWith("$Record.")) return "the record's " + humanName(v);
      if (/^\{!.+\}$/.test(v)) return humanName(v.slice(2, -1));
      return v;
    }
    // Business-language condition: "Team Requires Approval is not empty"
    function condTextBiz(rule) {
      if (!rule) return "";
      const parts = (rule.conditions || []).map((c) => {
        const l = humanName(c.leftValueReference || "");
        const rv = valOf(c.rightValue);
        if (c.operator === "IsNull") return l + (String(rv) === "true" ? " is empty" : " is not empty");
        if (c.operator === "IsChanged") return l + " has just changed";
        const op = ({ EqualTo: "is", NotEqualTo: "is not", GreaterThan: "is more than", GreaterThanOrEqualTo: "is at least", LessThan: "is less than", LessThanOrEqualTo: "is at most", Contains: "contains", StartsWith: "starts with", EndsWith: "ends with" })[c.operator] || c.operator;
        return l + " " + op + " " + humanVal(rv);
      });
      return parts.join(" and ");
    }

    function condText(rule) {
      const parts = (rule.conditions || []).map((c) => {
        const l = c.leftValueReference || ""; const op = ({ EqualTo: "=", NotEqualTo: "≠", GreaterThan: ">", GreaterThanOrEqualTo: "≥", LessThan: "<", LessThanOrEqualTo: "≤", IsNull: "is null", Contains: "contains", StartsWith: "starts with", IsChanged: "ISCHANGED" })[c.operator] || c.operator;
        return l + " " + op + " " + valOf(c.rightValue);
      });
      return parts.join(" AND ");
    }

    // Plain-word rendering of a flow value reference — full information, no
    function plainRef(s) {
      s = String(s == null ? "" : s);
      if (s.startsWith("$Record.")) return "the record's " + s.slice(8);
      return s;
    }
    function elDescription(kind, el) {
      const n = (a) => (a || []).length;
      const plural = (c, one, many) => c + " " + (c === 1 ? one : many);
      if (docMode === "business") switch (kind) {
        case "GET RECORDS": return "Finds the " + humanName(el.object || "record") + " record" + (n(el.filters) ? " it needs (" + (el.filters || []).map((x) => humanName(x.field) + " matches").join(", ") + ")" : "s") + ".";
        case "CREATE RECORDS": return "Creates a new " + humanName(el.object || "record") + (el.inputAssignments && el.inputAssignments.length ? ", filling in " + plural(el.inputAssignments.length, "field", "fields") + " (" + el.inputAssignments.slice(0, 4).map((a) => humanName(a.field)).join(", ") + (el.inputAssignments.length > 4 ? ", …" : "") + ")" : "") + ".";
        case "UPDATE RECORDS": {
          const tgt = el.inputReference === "$Record" || !el.object ? "the record that started this flow" : "the " + humanName(el.object);
          const flds = (el.inputAssignments || []).map((a) => humanName(a.field));
          return "Saves changes to " + tgt + (flds.length ? " — sets " + flds.slice(0, 4).join(", ") + (flds.length > 4 ? ", …" : "") : "") + ".";
        }
        case "DELETE RECORDS": return "Permanently deletes the " + humanName(el.object || "matched record(s)") + ".";
        case "DECISION": return "Decides which way to go — the branches below show each path.";
        case "ASSIGNMENT": {
          const names = (el.assignmentItems || []).map((a) => humanName(a.assignToReference)).filter(Boolean);
          const shown = names.slice(0, 3).join(", ") + (names.length > 3 ? " and " + (names.length - 3) + " more" : "");
          return "Makes a note of " + (shown || "some values") + " for later steps" + (isLocalOnly(el) ? " — nothing is saved to Salesforce yet." : ".");
        }
        case "SUBFLOW": return "Hands the work to another flow, “" + (el.flowName || "") + "”, waits for it to finish, then continues.";
        case "ACTION": return el.actionType === "emailAlert"
          ? "Sends an automated email (the “" + humanName(el.actionName || "") + "” alert)."
          : el.actionType === "apex"
            ? "Runs custom-built code (“" + (el.actionName || "") + "”) — what it changes lives in the code, not here."
            : "Performs the “" + humanName(el.actionName || el.actionType || "action") + "” action.";
        case "SCREEN": return "Shows the user a screen with " + plural(n(el.fields), "item", "items") + " to read or fill in.";
        case "LOOP": return "Repeats the following steps once for every item in " + humanName(el.collectionReference || "the list") + ".";
        case "WAIT": return "Pauses and waits for a scheduled time or event before continuing.";
        default: return "";
      }
      switch (kind) {
        case "GET RECORDS": return "Queries " + (el.object || "records") + (el.filters && el.filters.length ? " with " + el.filters.length + " filter(s)." : ".");
        case "CREATE RECORDS": return "Inserts a new " + (el.object || "record") + ".";
        case "UPDATE RECORDS": return el.inputReference === "$Record" ? "Writes back to the triggering record." : "Updates " + (el.object || "records") + ".";
        case "DELETE RECORDS": return "Deletes " + (el.object || "records") + ".";
        case "DECISION": return "Routes into " + ((el.rules || []).length + 1) + " outcomes. Which runs is runtime.";
        case "ASSIGNMENT": return "Sets " + (el.assignmentItems || []).length + " variable(s)" + (isLocalOnly(el) ? " — local variables only, no record write." : ".");
        case "SUBFLOW": return "Calls flow “" + (el.flowName || "") + "”.";
        case "ACTION": return actionDesc(el);
        case "SCREEN": return "Shows a screen with " + ((el.fields || []).length) + " component(s).";
        case "LOOP": return "Iterates over " + (el.collectionReference || "a collection") + ".";
        case "WAIT": return "Pauses until a configured event/time.";
        default: return "";
      }
    }
    function isLocalOnly(el) {
      return (el.assignmentItems || []).every((a) => !/^\$Record\./.test(a.assignToReference || ""));
    }
    function actionDesc(el) {
      const t = el.actionType;
      if (t === "emailAlert") return "Sends a defined email alert.";
      if (t === "apex") return "Invokes Apex. Internal reads/writes not visible from flow metadata.";
      if (t === "emailSimple") return "Sends an email.";
      return "Invokes action “" + (el.actionName || "") + "” (" + (t || "action") + ").";
    }
    // Side-by-side table for anything that maps one thing to another. Every
    function kv2(rows, h1, h2) {
      if (!rows.length) return "";
      return '<table class="kv2"><thead><tr><th>' + esc(h1) + "</th><th>" + esc(h2) + "</th></tr></thead><tbody>" +
        rows.map((r) => '<tr><td class="mono">' + esc(r[0]) + '</td><td class="mono">' + esc(r[1]) + "</td></tr>").join("") +
        "</tbody></table>";
    }
    function elKV(kind, el) {
      const kv = [];
      const biz = docMode === "business";
      const P = biz ? plainRef : (s) => s;
      const pill = (s) => '<span class="pill-code">' + esc(s) + "</span>";
      const wpill = (s) => '<span class="pill-warn">' + esc(s) + "</span>";
      if (kind === "DECISION") {
        const nameOf = (ref) => {
          if (!ref) return "End of flow";
          const t = lastByName && lastByName.get(ref);
          return t ? (t.el.label || ref) : ref;
        };
        const rows = (el.rules || []).map((r, i) => {
          const cond = condText(r) || "condition met";
          const tgt = nameOf(conn(r.connector));
          return '<div class="path-row"><span class="path-n">' + (i + 1) + '</span><b>' + esc(r.label || r.name) + "</b>" +
            '<span class="muted"> — ' + (biz ? "if " : "when ") + '</span><span class="pill-code">' + esc(cond) + "</span>" +
            '<span class="muted"> → then go to </span><b>“' + esc(tgt) + "”</b></div>";
        });
        rows.push('<div class="path-row"><span class="path-n">' + ((el.rules || []).length + 1) + '</span><b>' +
          esc(el.defaultConnectorLabel || "Default") + "</b>" +
          '<span class="muted"> — ' + (biz ? "if none of the above match" : "otherwise") + ' → then go to </span><b>“' +
          esc(nameOf(conn(el.defaultConnector))) + "”</b></div>");
        kv.push('<div class="paths"><div class="io-group-name">' + (biz ? "The paths, spelled out" : "Outcomes") + "</div>" + rows.join("") + "</div>");
      }
      if (kind === "GET RECORDS" && el.filters && el.filters.length)
        kv.push(kv2(el.filters.map((f) => [f.field, (f.operator && f.operator !== "EqualTo" ? f.operator + " " : "") + P(valOf(f.value))]),
          biz ? "Looking at" : "Filter field", biz ? "Must match" : "Value"));
      if ((kind === "CREATE RECORDS" || kind === "UPDATE RECORDS") && el.inputAssignments && el.inputAssignments.length)
        kv.push(kv2(el.inputAssignments.map((a) => [a.field, P(valOf(a.value))]),
          biz ? "Field being " + (kind === "CREATE RECORDS" ? "set" : "changed") : "Field", biz ? "New value" : "Value"));
      if (kind === "ASSIGNMENT" && el.assignmentItems && el.assignmentItems.length)
        kv.push(kv2(el.assignmentItems.map((a) => [a.assignToReference, (a.operator && a.operator !== "Assign" ? a.operator + " " : "") + P(valOf(a.value))]),
          biz ? "What it stores" : "Variable", biz ? "Where it comes from" : "Set to"));
      if (kind === "SUBFLOW") {
        if (el.inputAssignments && el.inputAssignments.length)
          kv.push(kv2(el.inputAssignments.map((a) => [a.name, P(valOf(a.value))]),
            biz ? "Information passed in" : "Input", biz ? "Taken from" : "Value"));
        if (el.outputAssignments && el.outputAssignments.length)
          kv.push(kv2(el.outputAssignments.map((a) => [a.name, a.assignToReference]),
            biz ? "Information returned" : "Output", biz ? "Stored as" : "Assigned to"));
      }
      if (kind === "ACTION") {
        if (el.actionType === "apex") {
          if (el.inputParameters && el.inputParameters.length)
            kv.push(kv2(el.inputParameters.map((p) => [p.name, P(valOf(p.value)) || "—"]),
              biz ? "Information given to the code" : "Input", biz ? "Taken from" : "Value"));
          if (el.outputParameters && el.outputParameters.length)
            kv.push(kv2(el.outputParameters.map((p) => [p.name, p.assignToReference || "—"]),
              biz ? "Information the code returns" : "Output", biz ? "Stored as" : "Assigned to"));
          kv.push((biz ? "<b>What the code changes:</b> " : "<b>Effect:</b> ") + wpill(biz ? "not visible from the flow — lives inside the Apex code" : "unknown — needs the class"));
        }
        if (el.actionType === "emailAlert")
          kv.push("<b>" + (biz ? "Email alert used" : "Alert") + ":</b> " + pill(el.actionName || "") + " " + '<span class="pill-code">named in flow</span>' +
            "<br><b>" + (biz ? "Who receives it / which template" : "Recipients/template") + ":</b> " + wpill(biz ? "stored in Setup, not readable from here — use the Open link" : "Metadata API — not readable here"));
      }
      return kv;
    }

    async function analyze(f) {
      currentFlow = f;
      row.hide && row.hide();
      const vId = f.ActiveVersionId || f.LatestVersionId;
      Shell.handoff = { flow: f };
      regions.analysis.innerHTML = Shell.spinner("Reading flow metadata for “" + (f.Label || f.ApiName) + "”…");
      try {
        const meta = await fetchFlowMeta(vId);
        const { out, byName } = walk(meta);
        lastByName = byName;
        const elCount = out.filter((o) => !o.isBranchLabel && !o.orphan).length;
        const branches = (meta.decisions || []).reduce((n, d) => n + (d.rules || []).length, 0);
        const nSub = (meta.subflows || []).length;
        const vars = meta.variables || [];
        const nIn = vars.filter((v) => v.isInput).length;

        const start = meta.start || {};
        const entry = start.filterFormula
          ? start.filterFormula
          : (start.filters || []).map((x) => x.field + " " + (x.operator || "=") + " " + valOf(x.value)).join(" AND ");

        // subflow reference boxes: read from the called flow (never inlined into parent order)
        const subBoxes = {};
        for (const sf of meta.subflows || []) {
          try {
            const defs = await OrgAPI.query("SELECT ActiveVersionId, LatestVersionId, Label, ApiName FROM FlowDefinitionView WHERE ApiName = '" + OrgAPI.esc(sf.flowName) + "'");
            const d = defs.records[0];
            if (d) {
              const subMeta = await fetchFlowMeta(d.ActiveVersionId || d.LatestVersionId);
              const subWalk = walk(subMeta).out.filter((o) => !o.isBranchLabel && !o.orphan);
              subBoxes[sf.name] = { def: d, meta: subMeta, els: subWalk };
            }
          } catch (e) { subBoxes[sf.name] = null; }
        }
        const io = summarizeIO(meta, subBoxes);

        // ---- render
        let html = Shell.analysisHead(esc(f.Label || f.ApiName), Links.open(Links.flowVersion(vId)));
        html += '<div class="doc-toolbar">' +
          '<span class="seg">' +
          '<button id="dmBusiness" class="' + (docMode === "business" ? "on" : "") + '">Business</button>' +
          '<button id="dmTechnical" class="' + (docMode === "technical" ? "on" : "") + '">Technical</button></span>' +
          '<span class="spacer"></span>' +
          '<button id="dlWord" class="btn-secondary">Download · Word</button></div>';
        if (docMode === "business") html += narrative(meta, io, f);

        html += Shell.sectionLabel("Summary");
        html += Shell.statCards([
          { k: "Type", v: esc(f.ProcessType === "Flow" ? "Screen Flow" : "Record-Triggered"), s: esc((start.triggerType === "RecordAfterSave" ? "After Save" : start.triggerType === "RecordBeforeSave" ? "Before Save" : start.triggerType || "") + " · v" + (meta.apiVersion || "")) },
          { k: "Trigger", v: esc(start.object || f.TriggerObjectOrEventLabel || "—"), s: esc(recTrig(start.recordTriggerType)) },
          { k: "Elements", v: String(elCount), s: branches + " branches · " + nSub + " subflow" + (nSub === 1 ? "" : "s") },
          { k: "Variables", v: String(vars.length), s: nIn + " in · " + (vars.length - nIn) + " local" }
        ]);

        if (docMode === "business") {
          html += Shell.sectionLabel("The story — step by step");
          html += '<div class="card story">';
          let sn = 1;
          const startSentence = f.ProcessType === "Flow"
            ? "A person starts this flow and it walks them through its screens."
            : "It runs automatically " + (start.triggerType === "RecordBeforeSave" ? "just before" : "right after") +
              " a " + (start.object || "record") + " is " +
              ({ Create: "created", Update: "updated", CreateAndUpdate: "created or updated", Delete: "deleted" }[start.recordTriggerType] || "saved") +
              (entry ? ", but only when: " + entry : "") + ".";
          html += '<div class="story-item"><span class="path-n">' + (sn++) + '</span><div><b>The flow starts.</b> <span>' + esc(startSentence) + "</span></div></div>";
          for (const o of out) {
            if (o.isBranchLabel) {
              const bc = o.rule ? condTextBiz(o.rule) : "";
              html += '<div class="story-branch" style="margin-left:' + (30 * Math.min(2, o.depth + 1)) + 'px">' +
                (o.rule ? "If <b>" + esc(o.label) + "</b>" + (bc ? ' <span class="muted">— when ' + esc(bc) + "</span>" : "")
                        : "Otherwise <b>(" + esc(o.label) + ")</b>") + ":</div>";
              continue;
            }
            let extra = "";
            if (o.kind === "SUBFLOW") {
              const box = subBoxes[o.name], sm = box && box.meta;
              if (sm) {
                const bits = [];
                if ((sm.recordLookups || []).length) bits.push("looks up " + sm.recordLookups.length + " set(s) of records");
                if ((sm.recordCreates || []).length) bits.push("creates " + sm.recordCreates.length + " new record(s)");
                if ((sm.recordUpdates || []).length) bits.push("changes " + sm.recordUpdates.length + " record(s)");
                if ((sm.recordDeletes || []).length) bits.push("deletes record(s)");
                if ((sm.screens || []).length) bits.push("shows " + sm.screens.length + " screen(s)");
                extra = '<div class="muted" style="margin-top:4px">That flow itself ' + (bits.length ? esc(bits.join(", ")) : "does no detectable record work") + ", then returns. " +
                  Links.open(Links.flowVersion(box.def.ActiveVersionId || box.def.LatestVersionId)) + "</div>";
              } else {
                extra = '<div class="muted" style="margin-top:4px">That flow could not be read from this session — its steps are UNAVAILABLE, not assumed.</div>';
              }
            }
            const t = String(o.el.label || o.name);
            html += '<div class="story-item" style="margin-left:' + (30 * Math.min(2, o.depth)) + 'px"><span class="path-n">' + (sn++) + "</span><div><b>" +
              esc(t) + (/[.?!]$/.test(t) ? "" : ".") + "</b> <span>" + esc(elDescription(o.kind, o.el)) + "</span>" +
              (o.orphan ? ' <span class="pill-warn">never reached from the start — dead branch</span>' : "") +
              extra + "</div></div>";
          }
          html += '<div class="story-item"><span class="path-n">' + sn + '</span><div><b>The flow ends.</b></div></div>';
          html += "</div>";
          html += '<div class="note">Want the exact values, filters, and variable names behind each step? Switch to <b>Technical</b> — nothing is hidden there.</div>';
        } else {
        html += Shell.sectionLabel("Every element, in order — what it does, connections, variables");

        if (start.object || start.triggerType) {
          html += flowEl(0, "START · RECORD-TRIGGERED", "$Record (" + (start.object || "") + ")",
            "Runs " + (start.triggerType === "RecordAfterSave" ? "after save" : start.triggerType === "RecordBeforeSave" ? "before save" : "") + " when the entry condition matches.",
            entry ? ["<b>Entry:</b> <span class=\"pill-code\">" + esc(entry) + "</span> <span class=\"badge b-mute\">metadata</span>"] : [],
            firstTarget(out), Links.open(Links.flowVersion(vId)));
        }

        for (const o of out) {
          if (o.isBranchLabel) {
            html += '<div class="branch-label" style="margin-left:' + (34 * Math.min(2, o.depth + 1)) + 'px">' + esc(o.label) +
              (o.cond ? ' <span class="pill-code">' + esc(o.cond) + "</span>" : "") + "</div>";
            continue;
          }
          const el = o.el;
          const nxt = nextLabel(el, o.kind);
          if (o.kind === "SUBFLOW") {
            const box = subBoxes[o.name];
            html += '<div class="flow-el subflow indent' + Math.min(2, o.depth) + '">' +
              '<div class="el-kind">Subflow · ' + esc(el.flowName) + (box ? " — read from the called flow" : "") + "</div>" +
              '<div class="el-name">' + esc(el.label || o.name) + "</div>" +
              '<div class="el-desc">' + esc(elDescription(o.kind, el)) + "</div>" +
              elKV(o.kind, el).map((k) => '<div class="el-kv">' + k + "</div>").join("") +
              (box
                ? '<div style="margin-top:10px">' + box.els.slice(0, 6).map((s) =>
                    '<div class="flow-el" style="margin-left:14px"><div class="el-kind">' + esc(s.kind) + '</div><div class="el-name">' + esc(s.el.label || s.name) + '</div><div class="el-desc">' + esc(elDescription(s.kind, s.el)) + "</div>" +
                    elKV(s.kind, s.el).map((k) => '<div class="el-kv">' + k + "</div>").join("") + "</div>").join("") +
                  '<div class="note">Referenced, not inlined — open the called flow for its full documentation. ' +
                  Links.open(Links.flowVersion(box.def.ActiveVersionId || box.def.LatestVersionId)) + "</div></div>"
                : '<div class="note">Called flow could not be read from this session ' + Shell.badge("UNAVAILABLE") + "</div>") +
              (nxt ? '<div class="el-next">→ ' + esc(nxt) + "</div>" : "") + "</div>";
            continue;
          }
          html += flowEl(Math.min(2, o.depth), o.kind + (o.orphan ? " · UNREACHED" : ""), el.label || o.name,
            elDescription(o.kind, el), elKV(o.kind, el), nxt, null,
            o.kind === "DECISION" ? "<b>Runtime path:</b> <span class=\"pill-warn\">unknown without a record</span>" : null);
        }

        if (elCount + 2 <= 18) {
          html += Shell.sectionLabel("Flow graph");
          html += '<div class="graph-wrap">' + graphSvg(out, start, f, meta) + "</div>";
        } else {
          html += Shell.sectionLabel("Flow graph");
          html += '<div class="note">This flow has ' + elCount + " elements — a rendered graph at this size is unreadable and adds nothing over Flow Builder's own canvas. The step-by-step documentation above is the map. " +
            Links.open(Links.flowVersion(vId), "Open in Flow Builder ↗") + "</div>";
        }
        }

        html += Shell.bottomGrid(
          Shell.meter("Flow metadata", 100) +
          '<div class="note">Apex action internals ' + Shell.badge("UNKNOWN") + " · Email alert recipients " + Shell.badge("UNAVAILABLE") + " — Orglens states gaps instead of guessing.</div>",
          [
            { mod: "execution", label: "When it runs → Execution Explorer" },
            { mod: "impact", label: "What depends on it → Impact Analyzer" }
          ]
        );

        regions.analysis.innerHTML = html;
        const wire = (id, fn) => { const n = document.getElementById(id); if (n) n.addEventListener("click", fn); };
        wire("dmBusiness", () => { if (docMode !== "business") { docMode = "business"; analyze(f); } });
        wire("dmTechnical", () => { if (docMode !== "technical") { docMode = "technical"; analyze(f); } });
        wire("dlWord", () => downloadWord(f));
      } catch (e) {
        regions.analysis.innerHTML = Shell.error("Flow metadata could not be read: " + e.message) +
          '<div class="note">Orglens will not reconstruct a flow it cannot read. ' + Links.open(Links.flowVersion(vId)) + "</div>";
      }
    }

    function recTrig(t) {
      return ({ Create: "create", Update: "update", CreateAndUpdate: "create or update", Delete: "delete" })[t] || "";
    }
    function firstTarget(out) {
      const first = out.find((o) => !o.isBranchLabel);
      return first ? (first.el.label || first.name) : null;
    }
    function nextLabel(el, kind) {
      if (kind === "DECISION") return null;
      const t = (el.connector && el.connector.targetReference) || null;
      return t;
    }
    function flowEl(indent, kind, name, desc, kvs, next, right, extra) {
      return '<div class="flow-el indent' + indent + '"><span class="node-dot"></span>' +
        (right ? '<div style="float:right">' + right + "</div>" : "") +
        '<div class="el-kind">' + esc(kind) + '</div><div class="el-name">' + esc(name) + "</div>" +
        (desc ? '<div class="el-desc">' + esc(desc) + "</div>" : "") +
        (extra ? '<div class="el-kv">' + extra + "</div>" : "") +
        (kvs || []).map((k) => '<div class="el-kv">' + k + "</div>").join("") +
        (next ? '<div class="el-next">→ ' + esc(next) + "</div>" : "") + "</div>";
    }

    // Simple layered SVG: rows by walk order depth-ish; boxes + straight edges.
    function graphSvg(out, start, f, meta) {
      const byName = indexElements(meta);
      const reached = out.filter((o) => !o.isBranchLabel && !o.orphan);

      // ---- nodes ----
      const trig = start.triggerType === "RecordAfterSave" ? "After Save"
        : start.triggerType === "RecordBeforeSave" ? "Before Save"
        : start.triggerType === "Scheduled" ? "Scheduled" : (start.triggerType || "");
      const nodes = new Map();
      nodes.set("__start", { label: "Start", sub: [start.object, trig].filter(Boolean).join(" · "), cap: true });
      const subOf = (kind, el) => {
        if (kind === "UPDATE RECORDS") return "writes " + ((el.inputAssignments || []).length || "") + " fields";
        if (kind === "CREATE RECORDS") return "creates a record";
        if (kind === "DELETE RECORDS") return "deletes records";
        if (kind === "GET RECORDS") return "get records";
        if (kind === "DECISION") return "decision";
        if (kind === "ASSIGNMENT") return "assignment";
        if (kind === "SUBFLOW") return "read from called flow";
        if (kind === "ACTION") return el.actionType === "emailAlert" ? "alert named" : (el.actionType === "apex" ? "effect unknown" : "action");
        if (kind === "SCREEN") return "screen";
        if (kind === "LOOP") return "loop";
        return kind.toLowerCase();
      };
      for (const o of reached) {
        const label = (o.kind === "SUBFLOW" ? "Subflow: " : "") + (o.el.label || o.name);
        nodes.set(o.name, { label, sub: subOf(o.kind, o.el), dashed: o.kind === "SUBFLOW" });
      }
      nodes.set("__end", { label: "End", sub: "", cap: true });

      // ---- edges (with branch labels) ----
      const edges = [];
      const add = (a, b, lbl) => { if (nodes.has(a) && b && (nodes.has(b) || b === "__end")) edges.push({ a, b, lbl: lbl || "" }); };
      add("__start", conn((meta.start || {}).connector) || meta.startElementReference, "");
      for (const o of reached) {
        const el = o.el;
        if (o.kind === "DECISION") {
          for (const rule of el.rules || []) add(o.name, conn(rule.connector) || "__end", rule.label || rule.name);
          add(o.name, conn(el.defaultConnector) || "__end", el.defaultConnectorLabel || "Default");
        } else if (o.kind === "LOOP") {
          add(o.name, conn(el.nextValueConnector) || "__end", "each item");
          add(o.name, conn(el.noMoreValuesConnector) || "__end", "after last");
        } else {
          const t = conn(el.connector);
          add(o.name, t || "__end", "");
          if (conn(el.faultConnector)) add(o.name, conn(el.faultConnector), "fault");
        }
      }

      // ---- layered layout: BFS depth = row, siblings centered per row ----
      const level = new Map([["__start", 0]]);
      const q = ["__start"];
      const kids = new Map();
      for (const e of edges) { if (!kids.has(e.a)) kids.set(e.a, []); kids.get(e.a).push(e.b); }
      while (q.length) {
        const n = q.shift();
        for (const c of kids.get(n) || []) if (c !== "__end" && !level.has(c)) { level.set(c, level.get(n) + 1); q.push(c); }
      }
      let maxL = 0; for (const v of level.values()) maxL = Math.max(maxL, v);
      for (const id of nodes.keys()) if (id !== "__end" && !level.has(id)) level.set(id, ++maxL);
      level.set("__end", maxL + 1);

      const perLevel = new Map();
      for (const [id] of nodes) { const l = level.get(id); if (!perLevel.has(l)) perLevel.set(l, []); perLevel.get(l).push(id); }

      const W = 172, H = 50, GX = 46, GY = 56;
      const widest = Math.max(...[...perLevel.values()].map((a) => a.length));
      const svgW = Math.max(640, widest * (W + GX) + 40);
      const svgH = (maxL + 2) * (H + GY) + 20;
      const pos = {};
      for (const [l, ids] of perLevel) {
        const rowW = ids.length * W + (ids.length - 1) * GX;
        let x = (svgW - rowW) / 2;
        for (const id of ids) { pos[id] = { x, y: 14 + l * (H + GY) }; x += W + GX; }
      }

      const mid = (id) => ({ x: pos[id].x + W / 2, y: pos[id].y });
      let s = '<svg viewBox="0 0 ' + svgW + " " + svgH + '" width="100%" style="min-width:' + Math.min(svgW, 980) + 'px" xmlns="http://www.w3.org/2000/svg">' +
        '<defs><marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#9fb0c6"/></marker></defs>';

      for (const e of edges) {
        const a = mid(e.a), b = mid(e.b);
        const x1 = a.x, y1 = a.y + H, x2 = b.x, y2 = b.y;
        if (level.get(e.b) > level.get(e.a)) {
          const my = (y1 + y2) / 2;
          s += '<path d="M' + x1 + " " + y1 + " C" + x1 + " " + my + "," + x2 + " " + my + "," + x2 + " " + y2 + '" fill="none" stroke="#c3cede" stroke-width="1.4" marker-end="url(#arr)"/>';
          if (e.lbl) s += '<text x="' + ((x1 + x2) / 2) + '" y="' + (my - 5) + '" text-anchor="middle" font-size="10.5" fill="#6b7785">' + esc(e.lbl) + "</text>";
        } else {
          const side = svgW - 16;
          s += '<path d="M' + (pos[e.a].x + W) + " " + (y1 - H / 2) + " C" + side + " " + (y1 - H / 2) + "," + side + " " + (y2 + H / 2) + "," + (pos[e.b].x + W) + " " + (y2 + H / 2) +
            '" fill="none" stroke="#c3cede" stroke-width="1.4" stroke-dasharray="4 3" marker-end="url(#arr)"/>';
          if (e.lbl) s += '<text x="' + (side - 6) + '" y="' + ((y1 + y2) / 2) + '" text-anchor="end" font-size="10.5" fill="#6b7785">' + esc(e.lbl) + "</text>";
        }
      }

      const trunc = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
      for (const [id, n] of nodes) {
        const p = pos[id];
        const wid = n.cap ? 120 : W, xo = p.x + (W - wid) / 2;
        s += '<rect x="' + xo + '" y="' + p.y + '" rx="10" width="' + wid + '" height="' + H + '" fill="' + (n.cap ? "#f7fafe" : "#fff") + '" stroke="#0b5cd6" stroke-width="1.3"' + (n.dashed ? ' stroke-dasharray="5 4"' : "") + "/>";
        s += '<text x="' + (p.x + W / 2) + '" y="' + (p.y + (n.sub ? 21 : 30)) + '" text-anchor="middle" font-size="12" font-weight="700" fill="#16325c">' + esc(trunc(n.label, 24)) + "</text>";
        if (n.sub) s += '<text x="' + (p.x + W / 2) + '" y="' + (p.y + 37) + '" text-anchor="middle" font-size="10.5" fill="#6b7785">' + esc(trunc(n.sub, 28)) + "</text>";
      }
      return s + "</svg>";
    }

    if (params && params.flow) analyze(params.flow);
    else if (params && params.term) listFlows(params.term);
    else listFlows("");
  };

  Shell.register("flowdocs", mod);
})();
