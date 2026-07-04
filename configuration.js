// MODULE 5 — Configuration Explorer. Question: "Where is this configured?"
(function () {
  const mod = {};
  const esc = (s) => Shell.esc(s);

  mod.mount = async (regions, params) => {
    let objectApi = params.objectApi || (Shell.handoff && Shell.handoff.objectApi) || null;
    const dg = await OrgAPI.describeGlobalCached().catch(() => ({ sobjects: [] }));
    const objs = dg.sobjects.filter((s) => s.queryable && s.layoutable).map((s) => s.name).sort();
    if (!objectApi || !objs.includes(objectApi)) objectApi = objs.includes("Opportunity") ? "Opportunity" : objs[0];

    let fieldCount = null;

    const row = Shell.searchRow(regions.search, {
      selects: [
        { id: "cfObj", label: "Object", options: objs.map((o) => ({ v: o, t: o })), value: objectApi },
        { id: "cfScope", label: "Metadata scope", options: [{ v: "field", t: "Fields" }, { v: "vr", t: "Validation rules" }, { v: "flow", t: "Flows" }, { v: "apex", t: "Apex classes" }, { v: "trigger", t: "Apex triggers" }, { v: "emailtemplate", t: "Email templates" }, { v: "lwc", t: "Lightning Web Components" }, { v: "aura", t: "Aura components" }, { v: "duprule", t: "Duplicate rules" }], value: "field" }
      ],
      placeholder: "Search fields on the selected object…",
      buttonLabel: "Locate",
      footNote: "Searches all standard + custom in the " + (OrgAPI.isSandbox() ? "sandbox" : "org") + " · no result limit",
      fetchSuggestions: async (term) => {
        objectApi = row.selectValue("cfObj");
        const scope = row.selectValue("cfScope");
        if (scope === "field") {
          const fields = await fieldsOf(objectApi);
          const t = term.toLowerCase();
          return fields.filter((f) => f.QualifiedApiName.toLowerCase().includes(t) || (f.Label || "").toLowerCase().includes(t))
            .map((f) => ({ name: f.QualifiedApiName, badge: "FIELD", meta: (f.DataType || "") + " · " + objectApi, onPick: () => locateField(f) }));
        }
        const comps = await MetaSearch.search(term, scope);
        return comps.map((c) => ({
          name: c.name, badge: c.badge, meta: c.meta,
          onPick: () => { Shell.handoff = { component: c, objectApi: c.objectApi }; Shell.activate("impact", { component: c }); }
        }));
      },
      onSubmit: () => {}
    });
    row.onSelectChange("cfObj", async (v) => { objectApi = v; fieldCount = null; showCount(); });

    async function fieldsOf(obj) {
      return OrgAPI.cached("fields:" + obj, async () => {
        const r = await OrgAPI.query(
          "SELECT QualifiedApiName, Label, DataType, DurableId FROM FieldDefinition WHERE EntityDefinitionId = '" + OrgAPI.esc(obj) + "' ORDER BY QualifiedApiName");
        return r.records;
      });
    }
    async function showCount() {
      const fields = await fieldsOf(objectApi).catch(() => []);
      fieldCount = fields.length;
      regions.results.innerHTML = '<div class="note">' + fieldCount + " fields on <b>" + esc(objectApi) + "</b> — type to search them all. " + Links.open(Links.objectFields(objectApi), "Open") + "</div>";
    }
    showCount();

    async function locateField(f) {
      const fieldApi = f.QualifiedApiName;
      const durToken = (f.DurableId || "").split(".").pop() || fieldApi;
      Shell.handoff = { objectApi, fieldName: fieldApi };
      regions.analysis.innerHTML = Shell.spinner("Locating every place " + fieldApi + " is configured…");
      try {
        // Readable surfaces
        const rows = [];
        // custom field id for dependency lookups
        let cfId = null;
        if (fieldApi.endsWith("__c")) {
          const dev = fieldApi.replace(/__c$/, "");
          const cf = await OrgAPI.tooling("SELECT Id, DeveloperName, TableEnumOrId FROM CustomField WHERE DeveloperName = '" + OrgAPI.esc(dev) + "'").catch(() => ({ records: [] }));
          const objIdSet = new Set([objectApi]);
          cfId = (cf.records.find((r) => objIdSet.has(r.TableEnumOrId)) || cf.records[0] || {}).Id || null;
        }

        // Dependency API: everything that references the field
        let deps = [];
        if (cfId) {
          const d = await OrgAPI.tooling("SELECT MetadataComponentId, MetadataComponentName, MetadataComponentType FROM MetadataComponentDependency WHERE RefMetadataComponentId = '" + cfId + "'").catch(() => null);
          if (d) deps = d.records;
        }
        // Every dependency type the org returns is rendered — nothing dropped.
        const typeLabel = {
          ValidationRule: "Validation Rule", Flow: "Flow", CustomField: "Formula field",
          ApexClass: "Apex", ApexTrigger: "Apex Trigger", Report: "Report",
          EmailTemplate: "Email Template", LightningComponentBundle: "Lightning Web Component",
          AuraDefinitionBundle: "Aura Component", DuplicateRule: "Duplicate Rule",
          WorkflowRule: "Workflow Rule", ProcessDefinition: "Approval Process",
          QuickActionDefinition: "Quick Action", FieldSet: "Field Set", Layout: "Page Layout", FlexiPage: "Lightning Page"
        };
        const order = Object.keys(typeLabel);
        deps.sort((a, b) => {
          const ai = order.indexOf(a.MetadataComponentType), bi = order.indexOf(b.MetadataComponentType);
          return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || String(a.MetadataComponentName).localeCompare(String(b.MetadataComponentName));
        });
        const seenDep = new Set();
        for (const d of deps) {
          const key = d.MetadataComponentType + "|" + d.MetadataComponentName;
          if (seenDep.has(key)) continue;
          seenDep.add(key);
          rows.push({
            type: typeLabel[d.MetadataComponentType] || d.MetadataComponentType,
            where: d.MetadataComponentName,
            badge: '<span class="pill-code">readable</span>',
            open: Links.open(Links.byType(d.MetadataComponentType, d.MetadataComponentId, d.MetadataComponentName, objectApi))
          });
        }
        if (deps.some((d) => /^Apex/.test(d.MetadataComponentType)))
          rows.push({ type: "Apex (dynamic)", where: "Dynamic SOQL / describe calls", badge: '<span class="pill-warn">text scan — not indexable</span>', open: Links.open(Links.lexBase() + "/lightning/setup/ApexClasses/home") });

        // Gaps are conditional: if the Dependency API already returned concrete
        const depTypes = new Set(deps.map((d) => d.MetadataComponentType));
        try {
          const fp = await OrgAPI.cached("flexi:" + objectApi, () =>
            OrgAPI.tooling("SELECT Id, DeveloperName, MasterLabel FROM FlexiPage WHERE EntityDefinitionId = '" + OrgAPI.esc(objectApi) + "'").then((r) => r.records));
          for (const x of fp) rows.push({
            type: "Lightning Page", where: x.MasterLabel || x.DeveloperName,
            badge: '<span class="pill-code">readable</span>',
            open: Links.open(Links.lexBase() + "/visualEditor/appBuilder.app?pageId=" + x.Id)
          });
          depTypes.add("FlexiPage");
        } catch (e) {}
        try {
          const cl = await OrgAPI.cached("compact:" + objectApi, () =>
            OrgAPI.tooling("SELECT Id, DeveloperName, SobjectType FROM CompactLayout WHERE SobjectType = '" + OrgAPI.esc(objectApi) + "'").then((r) => r.records));
          for (const x of cl) rows.push({
            type: "Compact Layout", where: x.DeveloperName,
            badge: '<span class="pill-code">readable</span>',
            open: Links.open(Links.compactLayouts(objectApi))
          });
          depTypes.add("__compact");
        } catch (e) {}
        const G = (type, where, url) => ({ type, where, open: Links.open(url), badge: '<span class="badge b-warn">Metadata API</span>', gap: true });
        const gaps = [];
        if (!depTypes.has("Layout")) gaps.push(G("Page Layouts", "which layouts place it (any object — incl. related lists)", Links.layouts(objectApi)));
        gaps.push(G("Record Types", "picklist availability & layout mapping", Links.lexBase() + "/lightning/setup/ObjectManager/" + objectApi + "/RecordTypes/view"));
        if (!depTypes.has("FlexiPage")) gaps.push(G("Lightning Pages", "placement", Links.lightningPages(objectApi)));
        gaps.push(G("Dynamic Forms visibility rules", "component visibility on Lightning Pages", Links.lightningPages(objectApi)));
        if (!depTypes.has("__compact")) gaps.push(G("Compact Layouts", "field membership", Links.compactLayouts(objectApi)));
        gaps.push(G("Field Sets", "field membership", Links.fieldSets(objectApi)));
        gaps.push(G("Search Layouts", "columns", Links.searchLayouts(objectApi)));
        gaps.push(G("Report Types", "field availability in report types", Links.lexBase() + "/lightning/setup/CustomReportTypes/home"));

        const readable = rows.length;
        const all = [...rows, ...gaps];

        regions.analysis.innerHTML =
          Shell.analysisHead("Where " + esc(fieldApi) + " is configured", Links.open(Links.field(objectApi, durToken), "Open field")) +
          Shell.statCards([
            { k: "Appears in", v: String(all.length) },
            { k: "Readable", v: String(readable) },
            { k: "Gaps", v: String(gaps.length) },
            { k: "Question", v: "Where?" }
          ]) +
          '<div id="cfgPaged"></div>' +

          '<div class="note">Rows above are org-wide — layouts on any object (incl. related lists), Apex, flows, reports, email templates, LWC/Aura.' + (cfId ? "" : " " + esc(fieldApi) + " is a standard field — Salesforce can\'t index references to standard fields, so only Setup surfaces are listed. " + Shell.badge("PARTIAL")) + "</div>" +
          Shell.bottomGrid(
            Shell.meter("Browser-readable locations", Math.round((readable / Math.max(1, all.length)) * 100)) +
            '<div class="note">Layout, record-type and Dynamic-Form placement lives only in the Metadata API — listed as gaps, never guessed.</div>',
            [
              { mod: "impact", label: "What breaks if changed → Impact Analyzer" },
              { mod: "permissions", label: "Who can edit → Permission Overlay" }
            ]
          );
        const cfgHost = document.getElementById("cfgPaged");
        if (cfgHost) Shell.resultsTable(cfgHost, {
          countLabel: all.length + " locations",
          columns: [{ h: "Location type", cls: "tname" }, { h: "Where" }, { h: "Read" }, { h: "", cls: "right" }],
          rows: all.map((r) => ({ cells: [esc(r.type), esc(r.where), r.badge, r.open] }))
        });
      } catch (e) { regions.analysis.innerHTML = Shell.error(e.message); }
    }

    if (params && params.fieldName) {
      const fields = await fieldsOf(objectApi).catch(() => []);
      const f = fields.find((x) => x.QualifiedApiName === params.fieldName);
      if (f) locateField(f);
    }
  };

  Shell.register("configuration", mod);
})();
