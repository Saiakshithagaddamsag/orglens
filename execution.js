// MODULE 3 — Execution Explorer. Question: "When can automation execute?"
(function () {
  const mod = {};
  const esc = (s) => Shell.esc(s);

  mod.mount = (regions, params) => {
    const row = Shell.searchRow(regions.search, {
      selects: [
        { id: "exOp", label: "Operation", options: [{ v: "Create", t: "Create" }, { v: "Update", t: "Update" }, { v: "Delete", t: "Delete" }, { v: "Undelete", t: "Undelete" }], value: params.op || "Update" },
        { id: "exCh", label: "Channel", options: [{ v: "any", t: "Any channel" }, { v: "ui", t: "UI" }, { v: "api", t: "API" }], value: "any" }
      ],
      placeholder: "Search the object whose pipeline you want (e.g. Opportunity)…",
      buttonLabel: "Explain",
      footNote: "Searches all standard + custom in the " + (OrgAPI.isSandbox() ? "sandbox" : "org") + " · no result limit",
      fetchSuggestions: async (term) => {
        const objs = await MetaSearch.search(term, "object");
        return objs.map((o) => ({ name: o.name, badge: "OBJECT", meta: o.meta, onPick: () => analyze(o.name, o.label) }));
      },
      onSubmit: async (term) => {
        if (!term) return;
        const objs = await MetaSearch.search(term, "object");
        if (objs[0]) analyze(objs[0].name, objs[0].label);
      }
    });

    async function analyze(objectApi, objectLabel) {
      const op = row.selectValue("exOp");
      Shell.handoff = { objectApi };
      regions.analysis.innerHTML = Shell.spinner("Reading the " + op.toLowerCase() + " pipeline for " + objectApi + "…");
      try {
        const [flows, triggers, vrs, dups, assigns, wfs, approvals] = await Promise.all([
          OrgAPI.queryUnion(["RecordBeforeSave", "RecordAfterSave", "RecordBeforeDelete"].map((tt) =>
            "SELECT DurableId, ApiName, Label, TriggerType, RecordTriggerType, TriggerObjectOrEventLabel, IsActive, ActiveVersionId, LatestVersionId FROM FlowDefinitionView WHERE TriggerType = '" + tt + "' AND IsActive = true"), (f) => f.DurableId)
            .then((records) => ({ records })).catch(() => ({ records: [] })),
          OrgAPI.query("SELECT Id, Name, Status, TableEnumOrId, UsageBeforeInsert, UsageAfterInsert, UsageBeforeUpdate, UsageAfterUpdate, UsageBeforeDelete, UsageAfterDelete, UsageAfterUndelete FROM ApexTrigger WHERE TableEnumOrId = '" + OrgAPI.esc(objectApi) + "'").catch(() => ({ records: [] })),
          OrgAPI.tooling("SELECT Id, ValidationName, Active FROM ValidationRule WHERE EntityDefinition.QualifiedApiName = '" + OrgAPI.esc(objectApi) + "'").catch(() => null),
          OrgAPI.query("SELECT Id, DeveloperName, IsActive FROM DuplicateRule WHERE SobjectType = '" + OrgAPI.esc(objectApi) + "'").catch(() => null),
          ["Lead", "Case"].includes(objectApi) ? OrgAPI.query("SELECT Id, Name, Active FROM AssignmentRule WHERE SobjectType = '" + objectApi + "'").catch(() => null) : Promise.resolve({ na: true }),
          OrgAPI.tooling("SELECT Id, Name, TableEnumOrId FROM WorkflowRule WHERE TableEnumOrId = '" + OrgAPI.esc(objectApi) + "'").catch(() => null),
          OrgAPI.query("SELECT Id, Name, State, TableEnumOrId FROM ProcessDefinition WHERE TableEnumOrId = '" + OrgAPI.esc(objectApi) + "' AND Type = 'Approval'").catch(() => null)
        ]);

        const matchObj = (f) => (f.TriggerObjectOrEventLabel === objectLabel || f.TriggerObjectOrEventLabel === objectApi);
        const opMatch = (f) => {
          const r = f.RecordTriggerType;
          if (op === "Create") return r === "Create" || r === "CreateAndUpdate";
          if (op === "Update") return r === "Update" || r === "CreateAndUpdate";
          if (op === "Delete") return r === "Delete" || f.TriggerType === "RecordBeforeDelete";
          return false;
        };
        const before = flows.records.filter((f) => f.TriggerType === "RecordBeforeSave" && matchObj(f) && opMatch(f));
        const after = flows.records.filter((f) => f.TriggerType === "RecordAfterSave" && matchObj(f) && opMatch(f));

        const trgFlag = { Create: ["UsageBeforeInsert", "UsageAfterInsert"], Update: ["UsageBeforeUpdate", "UsageAfterUpdate"], Delete: ["UsageBeforeDelete", "UsageAfterDelete"], Undelete: [null, "UsageAfterUndelete"] }[op];
        const beforeTrg = triggers.records.filter((t) => trgFlag[0] && t[trgFlag[0]]);
        const afterTrg = triggers.records.filter((t) => trgFlag[1] && t[trgFlag[1]]);

        const flowLine = (f) => '<div class="el-kv"><span class="pill-code">' + esc(f.Label) + "</span> " +
          Shell.badge("ACTIVE") + " " + Links.open(Links.flowVersion(f.ActiveVersionId || f.LatestVersionId)) +
          ' <button class="chip" style="padding:2px 10px" data-goto="flowdocs">Docs</button></div>';
        const trgLine = (t) => '<div class="el-kv"><span class="pill-code">' + esc(t.Name) + "</span> " +
          (t.Status === "Active" ? Shell.badge("ACTIVE") : Shell.badge("Inactive")) + " " + Links.open(Links.apexTrigger(t.Id)) +
          ' <span class="muted">outcome depends on the class — not predicted</span></div>';
        const none = (what) => '<div class="muted">No ' + what + " for this object + operation. " + Shell.badge("CONFIRMED") + "</div>";
        const unavailable = (why, link) => '<span class="muted">' + esc(why) + "</span> " + Shell.badge("UNAVAILABLE") + (link ? " " + Links.open(link) : "");

        const phases = [];
        let n = 1;
        phases.push({ num: n++, title: "Entry point", badge: Shell.badge("CONFIRMED"), body: "<b>" + esc(objectApi) + "</b> · Operation: <b>" + esc(op) + "</b> · Channel: <b>" + esc(({ any: "Any", ui: "UI", api: "API" })[row.selectValue("exCh")] || row.selectValue("exCh").toUpperCase()) + "</b>" });
        if (op !== "Delete") phases.push({
          num: n++, title: "Before Save flows", badge: Shell.badge(before.length ? "CONFIRMED" : "CONFIRMED"),
          body: before.length ? before.map(flowLine).join("") : none("before-save flows")
        });
        phases.push({ num: n++, title: "Before triggers (Apex)", badge: Shell.badge("CONFIRMED"), body: beforeTrg.length ? beforeTrg.map(trgLine).join("") : none("before triggers") });
        phases.push({
          num: n++, title: "Validation rules", badge: vrs ? Shell.badge("CONFIRMED") : Shell.badge("UNAVAILABLE"),
          body: vrs
            ? ((vrs.records.filter((v) => v.Active).map((v) => '<div class="el-kv"><span class="pill-code">' + esc(v.ValidationName) + "</span> " + Shell.badge("ACTIVE") + " " + Links.open(Links.validationRule(objectApi, v.Id)) + "</div>").join("")) || none("active validation rules"))
            : unavailable("Tooling API denied ValidationRule for this session.", Links.object(objectApi))
        });
        phases.push({
          num: n++, title: "Duplicate rules", badge: dups ? Shell.badge("CONFIRMED") : Shell.badge("UNAVAILABLE"),
          body: dups ? ((dups.records.filter((d) => d.IsActive).map((d) => '<div class="el-kv"><span class="pill-code">' + esc(d.DeveloperName) + "</span> " + Links.open(Links.duplicateRules()) + "</div>").join("")) || none("active duplicate rules")) : unavailable("DuplicateRule not queryable here.", Links.duplicateRules())
        });
        phases.push({
          num: n++, title: "Assignment rules", badge: assigns && assigns.na ? Shell.badge("N/A", "b-mute") : assigns ? Shell.badge("CONFIRMED") : Shell.badge("UNAVAILABLE"),
          body: assigns && assigns.na ? '<span class="muted">Assignment rules exist only for Lead and Case.</span>'
            : assigns ? ((assigns.records.filter((a) => a.Active).map((a) => '<div class="el-kv"><span class="pill-code">' + esc(a.Name) + "</span> " + Shell.badge("ACTIVE") + " " + Links.open(objectApi === "Lead" ? Links.leadAssignment() : Links.caseAssignment()) + "</div>").join("")) || none("active assignment rules"))
            : unavailable("AssignmentRule not queryable here.", Links.leadAssignment())
        });
        phases.push({
          num: n++, title: "Workflow rules", badge: wfs ? Shell.badge("CONFIRMED") : Shell.badge("UNAVAILABLE"),
          body: wfs ? ((wfs.records.map((w) => '<div class="el-kv"><span class="pill-code">' + esc(w.Name) + "</span> " + Links.open(Links.workflows()) + "</div>").join("")) || none("workflow rules")) : unavailable("WorkflowRule (Tooling) not readable — criteria and actions live in the Metadata API.", Links.workflows())
        });
        phases.push({
          num: n++, title: "Approval processes", badge: approvals ? Shell.badge("CONFIRMED") : Shell.badge("UNAVAILABLE"),
          body: approvals ? ((approvals.records.filter((a) => a.State === "Active").map((a) => '<div class="el-kv"><span class="pill-code">' + esc(a.Name) + "</span> " + Shell.badge("ACTIVE") + " " + Links.open(Links.approvals()) + '</div>').join("")) || none("active approval processes")) + '<div class="muted">Whether one fires depends on entry criteria + a user submitting — Orglens does not guess approvals.</div>' : unavailable("ProcessDefinition not queryable here.", Links.approvals())
        });
        phases.push({ num: n++, title: "After triggers (Apex)", badge: Shell.badge("CONFIRMED"), body: afterTrg.length ? afterTrg.map(trgLine).join("") : none("after triggers") });
        if (op !== "Delete") phases.push({ num: n++, title: "After Save flows", badge: Shell.badge("CONFIRMED"), body: after.length ? after.map(flowLine).join("") : none("after-save flows") });
        phases.push({ num: n++, title: "Rollups & commit", badge: Shell.badge("PARTIAL"), body: '<span class="muted">Standard rollup recalculation and DML commit happen here. Custom rollup tooling (e.g. managed packages) is not statically detectable — check installed packages.</span>' });
        // Scheduled paths ARE readable — inside each matched after-save flow's
        let schedRows = [];
        try {
          const metas = await Promise.all(after.map((f) =>
            OrgAPI.cached("flowmeta:" + (f.ActiveVersionId || f.LatestVersionId), () =>
              OrgAPI.toolingGet("/sobjects/Flow/" + (f.ActiveVersionId || f.LatestVersionId)).then((r) => r.Metadata))
              .then((mm) => ({ f, paths: (mm.start && mm.start.scheduledPaths) || [] }))
              .catch(() => ({ f, paths: null }))));
          for (const m of metas) {
            if (m.paths === null) schedRows.push('<div class="el-kv"><span class="pill-code">' + esc(m.f.Label) + "</span> " + Shell.badge("UNAVAILABLE") + ' <span class="muted">flow not readable</span></div>');
            else for (const sp of m.paths) schedRows.push(
              '<div class="el-kv"><span class="pill-code">' + esc(m.f.Label) + "</span> → <b>" + esc(sp.label || sp.name) + "</b> " +
              '<span class="muted">(' + esc(String(sp.offsetNumber || 0)) + " " + esc((sp.offsetUnit || "").toLowerCase()) + " " + esc((sp.timeSource || "").replace("RecordTriggerEvent", "after trigger")) + ")</span> " +
              Links.open(Links.flowVersion(m.f.ActiveVersionId || m.f.LatestVersionId)) + "</div>");
          }
        } catch (err) { schedRows = []; }
        let cron = null;
        try { cron = await OrgAPI.query("SELECT Id, CronJobDetail.Name, State, NextFireTime FROM CronTrigger WHERE State IN ('WAITING','ACQUIRED','EXECUTING')"); } catch (err) {}
        phases.push({
          num: n++, title: "Scheduled paths (from the flows above)", badge: schedRows.length ? Shell.badge("CONFIRMED") : Shell.badge("CONFIRMED"),
          body: schedRows.length ? schedRows.join("") : none("scheduled paths on the matched flows")
        });
        phases.push({
          num: n++, title: "Scheduled Apex jobs (org-wide)", badge: cron ? "" : Shell.badge("UNAVAILABLE"),
          body: cron
            ? '<div id="cronPaged"></div><div class="muted">Which objects a job touches lives in its Apex code.</div>'
            : unavailable("CronTrigger not queryable here.", Links.lexBase() + "/lightning/setup/ScheduledJobs/home")
        });
        // Async surfaces readable from the browser.
        let queueables = null, eventTriggers = null;
        try {
          const q = await OrgAPI.tooling("SELECT ApexClassId, ClassName FROM ApexTypeImplementor WHERE InterfaceName = 'System.Queueable'");
          queueables = q.records;
        } catch (err) {}
        try {
          const et = await OrgAPI.query("SELECT Id, Name, TableEnumOrId, Status FROM ApexTrigger WHERE TableEnumOrId LIKE '%__e'");
          eventTriggers = et.records;
        } catch (err) {}
        phases.push({
          num: n++, title: "Queueable Apex classes (org-wide)", badge: queueables ? "" : Shell.badge("UNAVAILABLE"),
          body: queueables
            ? (queueables.length ? '<div id="qPaged"></div>' : none("Queueable implementations"))
            : unavailable("ApexTypeImplementor not queryable in this org version.", Links.lexBase() + "/lightning/setup/ApexClasses/home")
        });
        phases.push({
          num: n++, title: "Platform-event subscribers (Apex triggers on events)", badge: eventTriggers ? "" : Shell.badge("UNAVAILABLE"),
          body: eventTriggers
            ? (eventTriggers.length
              ? eventTriggers.map((t) => '<div class="el-kv"><span class="pill-code">' + esc(t.Name) + '</span> <span class="muted">on ' + esc(t.TableEnumOrId) + "</span> " + Links.open(Links.apexTrigger(t.Id)) + "</div>").join("")
              : none("platform-event triggers"))
            : unavailable("ApexTrigger not queryable here.", Links.lexBase() + "/lightning/setup/ApexTriggers/home")
        });
        phases.push({
          num: n++, title: "Future-method chains", badge: Shell.badge("UNAVAILABLE"), dim: true,
          body: '<span class="muted">@future is a method-level annotation inside class bodies — not statically listable.</span> ' + Links.open(Links.lexBase() + "/lightning/setup/ApexClasses/home", "Open Apex Classes")
        });

        const readable = phases.filter((p) => /CONFIRMED|N\/A/.test(p.badge)).length;
        const covPct = Math.round((readable / phases.length) * 100);

        regions.analysis.innerHTML =
          Shell.analysisHead(esc(objectApi) + " · " + esc(op) + " pipeline", Links.open(Links.object(objectApi))) +

          Shell.statCards([
            { k: "Before-save flows", v: String(before.length) },
            { k: "Apex triggers", v: String(beforeTrg.length + afterTrg.length) },
            { k: "Validation rules", v: vrs ? String(vrs.records.filter((v) => v.Active).length) : "—" },
            { k: "Coverage", v: covPct + "%" }
          ]) +
          Shell.sectionLabel("Execution phases (in order)") +
          phases.map((p) => Shell.layer({ num: p.num, title: p.title, statusBadge: p.badge, bodyHtml: p.body, dim: p.dim })).join("") +
          Shell.bottomGrid(
            Shell.meter("Pipeline phases readable", covPct) +
            '<div class="note">Workflow criteria, approval entry criteria, and async chains are gaps — listed, not guessed.</div>',
            [
              { mod: "flowdocs", label: "Flow internals → Flow Analyzer" },
              { mod: "impact", label: "Dependencies → Impact Analyzer" },
              { mod: "permissions", label: "Who can trigger this → Permission Overlay" }
            ]
          );
        const cronHost = document.getElementById("cronPaged");
        if (cronHost && cron) Shell.resultsTable(cronHost, {
          countLabel: cron.records.length + " scheduled jobs",
          columns: [{ h: "Job", cls: "tname" }, { h: "State" }, { h: "Next fire" }, { h: "", cls: "right" }],
          rows: cron.records.map((cj) => ({
            cells: [esc(cj.CronJobDetail ? cj.CronJobDetail.Name : cj.Id), esc(cj.State),
              esc((cj.NextFireTime || "").replace("T", " ").slice(0, 16)),
              Links.open(Links.lexBase() + "/lightning/setup/ScheduledJobs/home")]
          }))
        });
        const qHost = document.getElementById("qPaged");
        if (qHost && queueables && queueables.length) Shell.resultsTable(qHost, {
          countLabel: queueables.length + " Queueable classes",
          columns: [{ h: "Class", cls: "tname" }, { h: "", cls: "right" }],
          rows: queueables.map((q) => ({ cells: [esc(q.ClassName), Links.open(Links.apexClass(q.ApexClassId))] }))
        });
      } catch (e) { regions.analysis.innerHTML = Shell.error(e.message); }
    }

    if (params && params.objectApi) analyze(params.objectApi, params.objectApi);
  };

  Shell.register("execution", mod);
})();
