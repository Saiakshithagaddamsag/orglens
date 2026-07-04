// MODULE 0 — Impact Analyzer. Question: "If I change this, what breaks?"
(function () {
  const mod = {};

  mod.mount = (regions, params) => {
    let typeSel = "all";
    const row = Shell.searchRow(regions.search, {
      selects: [
        { id: "impType", label: "Component type", options: MetaSearch.TYPES, value: "all" },
        { id: "impStatus", label: "Scope", options: [{ v: "all", t: "All" }, { v: "active", t: "Active" }], value: "all" }
      ],
      placeholder: "Search any component — objects, fields, flows, Apex, validation rules…",
      buttonLabel: "Generate",
      footNote: "Searches all standard + custom in the " + (OrgAPI.isSandbox() ? "sandbox" : "org") + " · no result limit",
      fetchSuggestions: async (term) => {
        const res = await MetaSearch.search(term, row.selectValue("impType"));
        return res.map((c) => ({ name: c.name, badge: c.badge, meta: c.meta, onPick: () => analyze(c) }));
      },
      onSubmit: (term) => term && listResults(term)
    });

    async function listResults(term) {
      regions.results.innerHTML = Shell.spinner("Searching every component that matches “" + term + "” — full org, no limit…");
      try {
        const res = await MetaSearch.search(term, row.selectValue("impType"));
        Shell.resultsTable(regions.results, {
          countLabel: res.length + " matches",
          columns: [{ h: "Component", cls: "tname" }, { h: "Type" }, { h: "Object" }, { h: "", cls: "right" }],
          rows: res.map((c) => ({
            cells: [Shell.esc(c.name), Shell.typeBadge(c.badge), Shell.esc(c.meta || "—"), Links.open(c.openUrl)],
            onClick: () => analyze(c)
          })),
          emptyText: "No components match. Orglens searched the entire org."
        });
      } catch (e) { regions.results.innerHTML = Shell.error(e.message); }
    }

    async function analyze(c) {
      Shell.handoff = { objectApi: c.objectApi, fieldName: c.kind === "field" ? c.name : null, component: c };
      regions.analysis.innerHTML = Shell.spinner("Building the dependency graph for " + c.name + "…");
      try {
        // MetadataComponentDependency: the only browser-readable dependency source.
        const inQ = OrgAPI.tooling(
          "SELECT MetadataComponentId, MetadataComponentName, MetadataComponentType FROM MetadataComponentDependency WHERE RefMetadataComponentId = '" + OrgAPI.esc(c.id) + "'"
        );
        const outQ = OrgAPI.tooling(
          "SELECT RefMetadataComponentId, RefMetadataComponentName, RefMetadataComponentType FROM MetadataComponentDependency WHERE MetadataComponentId = '" + OrgAPI.esc(c.id) + "'"
        ).catch(() => ({ records: [] }));

        const incoming = (await inQ).records;
        const outgoing = (await outQ).records;

        // Downstream: second-level incoming, chunked IN queries, deduplicated.
        const directIds = [...new Set(incoming.map((r) => r.MetadataComponentId))];
        const downstream = new Map();
        for (let i = 0; i < directIds.length; i += 50) {
          const chunk = directIds.slice(i, i + 50).map((id) => "'" + id + "'").join(",");
          const lvl2 = await OrgAPI.tooling(
            "SELECT MetadataComponentId, MetadataComponentName, MetadataComponentType, RefMetadataComponentId FROM MetadataComponentDependency WHERE RefMetadataComponentId IN (" + chunk + ")"
          ).catch(() => ({ records: [] }));
          for (const r of lvl2.records) {
            if (r.MetadataComponentId !== c.id && !directIds.includes(r.MetadataComponentId))
              downstream.set(r.MetadataComponentId, r);
          }
        }

        const blast = new Set([...directIds, ...downstream.keys()]);
        const hasApex = incoming.some((r) => /^Apex/.test(r.MetadataComponentType));

        // Coverage: deterministic — which dependency channels are browser-readable here.
        const channels = [
          { name: "Dependency API", ok: true },
          { name: "Dynamic SOQL (Apex bodies)", ok: false, gap: "Dynamic SOQL may hide field access", when: hasApex },
          { name: "Report columns", ok: true },
          { name: "Hard-coded Ids / text", ok: false, gap: "Free-text references are not indexed", when: true }
        ].filter((x) => x.ok || x.when);
        const covPct = Math.round((channels.filter((x) => x.ok).length / channels.length) * 100);

        // Surfaces where this component TYPE is commonly referenced but which the
        const SURFACES = {
          EmailTemplate: [
            ["Email Alerts (Workflow)", "alerts send this template", Links.emailAlerts()],
            ["Flows — Send Email / email alert actions", "flow actions can name it", Links.lexBase() + "/lightning/setup/Flows/home"],
            ["Approval Processes", "approval notifications", Links.approvals()],
            ["Apex (Messaging.SingleEmailMessage)", "code can set templateId", Links.lexBase() + "/lightning/setup/ApexClasses/home"]
          ],
          LightningComponentBundle: [
            ["Lightning Pages (Record/App/Home)", "placement", Links.lexBase() + "/lightning/setup/FlexiPageList/home"],
            ["Utility Bar / App Manager", "utility items", Links.lexBase() + "/lightning/setup/NavigationMenus/home"],
            ["Quick Actions (LWC actions)", "action targets", Links.lexBase() + "/lightning/setup/GlobalActionsList/home"],
            ["Flow Screen Components", "screens can embed it", Links.lexBase() + "/lightning/setup/Flows/home"],
            ["Other LWCs / Aura (composition)", "parent components", Links.lexBase() + "/lightning/setup/LightningComponentBundles/home"]
          ],
          AuraDefinitionBundle: [
            ["Lightning Pages", "placement", Links.lexBase() + "/lightning/setup/FlexiPageList/home"],
            ["Quick Actions", "action targets", Links.lexBase() + "/lightning/setup/GlobalActionsList/home"],
            ["Other Aura / LWC (composition)", "parent components", Links.lexBase() + "/lightning/setup/LightningComponentBundles/home"],
            ["Visualforce (lightning:out)", "embedded usage", Links.lexBase() + "/lightning/setup/ApexPages/home"]
          ],
          DuplicateRule: [
            ["Matching Rules", "this rule is built on them", Links.matchingRules()],
            ["Save pipeline — every insert/update of its object", "changing it changes save behavior for UI, API, flows and Apex DML", Links.duplicateRules()]
          ],
          Flow: [
            ["Quick Actions / Buttons", "can launch this flow", Links.lexBase() + "/lightning/setup/GlobalActionsList/home"],
            ["Other Flows (subflow calls)", "shown in Flow Analyzer", Links.lexBase() + "/lightning/setup/Flows/home"]
          ],
          RecordType: [
            ["Flows / Validation Rules / Apex / LWC / Aura", "record-type checks are common — indexed ones appear above", Links.lexBase() + "/lightning/setup/ObjectManager/home"],
            ["Page Layout & Compact Layout assignments", "per-profile mapping", Links.lexBase() + "/lightning/setup/ObjectManager/home"],
            ["Business/Support Processes & Paths", "stage definitions", Links.lexBase() + "/lightning/setup/PathAssistantSetupHome/home"],
            ["Reports & SOQL filters", "record-type filters are free text", Links.lexBase() + "/lightning/o/Report/home"]
          ],
          MatchingRule: [
            ["Duplicate Rules", "built on this matching rule", Links.duplicateRules()]
          ],
          ValidationRule: [
            ["Incoming: usually nothing references a validation rule", "its own outgoing references (fields, record types, custom permissions) are in the Outgoing table below", Links.lexBase() + "/lightning/setup/ObjectManager/home"]
          ],
          Layout: [
            ["Record Types", "layout mapping per record type", Links.lexBase() + "/lightning/setup/ObjectManager/home"]
          ],
          FlexiPage: [
            ["App / Profile / Record-type activations", "which apps and profiles this page is active for", Links.lexBase() + "/lightning/setup/FlexiPageList/home"]
          ],
          CustomField: [
            ["Dynamic Forms visibility / Paths / Search Layouts", "full surface list in Configuration Explorer", Links.lexBase() + "/lightning/setup/ObjectManager/home"]
          ]
        };
        // Layout incoming is genuinely readable: ProfileLayout assignments.
        let assignRows = [];
        if (c.type === "Layout") {
          try {
            const pl = await OrgAPI.tooling("SELECT Id, ProfileId, RecordTypeId FROM ProfileLayout WHERE LayoutId = '" + OrgAPI.esc(c.id) + "'");
            const profIds = [...new Set(pl.records.map((r) => r.ProfileId).filter(Boolean))];
            const rtIds = [...new Set(pl.records.map((r) => r.RecordTypeId).filter(Boolean))];
            const pName = {}, rName = {};
            if (profIds.length) (await OrgAPI.query("SELECT Id, Name FROM Profile WHERE Id IN (" + profIds.map((x) => "'" + x + "'").join(",") + ")").catch(() => ({ records: [] }))).records.forEach((p) => (pName[p.Id] = p.Name));
            if (rtIds.length) (await OrgAPI.query("SELECT Id, Name FROM RecordType WHERE Id IN (" + rtIds.map((x) => "'" + x + "'").join(",") + ")").catch(() => ({ records: [] }))).records.forEach((p) => (rName[p.Id] = p.Name));
            assignRows = pl.records.map((r) => ({
              cells: [
                Shell.typeBadge("PROFILE"),
                '<span class="tname">' + Shell.esc(pName[r.ProfileId] || r.ProfileId) + "</span>" +
                  ' <span class="muted">— record type: ' + Shell.esc(r.RecordTypeId ? (rName[r.RecordTypeId] || r.RecordTypeId) : "Master") + "</span>",
                "Assigns (layout assignment)",
                Links.open(Links.profile(r.ProfileId))
              ]
            }));
          } catch (e) { /* falls back to surface rows below */ }
        }

        const surfaceRows = (SURFACES[c.type] || []).map((s) => ({
          cells: [
            Shell.badge("UNKNOWN"),
            '<span class="tname">' + Shell.esc(s[0]) + "</span>",
            Shell.esc(s[1]) + " — not indexed, check here",
            Links.open(s[2])
          ]
        }));

        const rows = incoming.map((r) => ({
          cells: [
            Shell.typeBadge(prettyType(r.MetadataComponentType)),
            '<span class="tname">' + Shell.esc(r.MetadataComponentName) + "</span>",
            Shell.esc(relation(r.MetadataComponentType)),
            Links.open(Links.byType(r.MetadataComponentType, r.MetadataComponentId, r.MetadataComponentName, c.objectApi))
          ]
        }));

        regions.analysis.innerHTML =
          Shell.analysisHead(Shell.esc(c.name) + " dependents", Links.open(c.openUrl)) +
          Shell.statCards([
            { k: "Direct", v: String(directIds.length) },
            { k: "Downstream", v: String(downstream.size) },
            { k: "Blast radius", v: String(blast.size) }
          ]) +
          '<div class="panel"><h4>Incoming — who depends on ' + Shell.esc(c.name) + '? (if I change this, what could break?)</h4><div id="impTable"></div></div>' +
          '<div class="panel" style="margin-top:14px"><h4>Outgoing — what does ' + Shell.esc(c.name) + ' depend on? (if one of these changes, could it break?)</h4><div id="impOutTable"></div></div>' +
          Shell.bottomGrid(
            Shell.meter("Dependency API", covPct) +
            channels.filter((x) => !x.ok).map((x) =>
              '<div class="note">' + Shell.esc(x.gap) + " " + Shell.badge("UNKNOWN") + "</div>").join(""),
            relatedFor(c)
          );

        Shell.resultsTable(document.getElementById("impTable"), {
          countLabel: incoming.length + " direct references",
          columns: [{ h: "Type" }, { h: "Component", cls: "tname" }, { h: "Relationship" }, { h: "", cls: "right" }],
          rows: assignRows.concat(rows).concat(surfaceRows),
          emptyText: "Nothing in this org references " + c.name + " in indexed metadata. Possible surfaces below still apply."
        });
        Shell.resultsTable(document.getElementById("impOutTable"), {
          countLabel: outgoing.length + " forward dependencies",
          columns: [{ h: "Type" }, { h: "Component", cls: "tname" }, { h: "Relationship" }, { h: "", cls: "right" }],
          rows: outgoing.map((r) => ({
            cells: [
              Shell.typeBadge(prettyType(r.RefMetadataComponentType)),
              '<span class="tname">' + Shell.esc(r.RefMetadataComponentName) + "</span>",
              Shell.esc(relation(r.RefMetadataComponentType)),
              Links.open(Links.byType(r.RefMetadataComponentType, r.RefMetadataComponentId, r.RefMetadataComponentName, c.objectApi))
            ]
          })),
          emptyText: c.name + " has no indexed forward dependencies."
        });
      } catch (e) {
        regions.analysis.innerHTML =
          Shell.analysisHead(Shell.esc(c.name) + " dependents", Links.open(c.openUrl)) +
          Shell.layer({
            num: "!", title: "Dependency API", statusBadge: Shell.badge("UNAVAILABLE"),
            bodyHtml: "MetadataComponentDependency could not be queried in this org (" + Shell.esc(e.message) +
              "). Orglens will not guess dependencies. " + Links.open(Links.lexBase() + "/lightning/setup/SetupOneHome/home", "Open Setup")
          });
      }
    }

    function relatedFor(c) {
      const chips = [];
      if (c.kind === "field" || c.kind === "object") {
        chips.push({ mod: "permissions", label: "Who can edit → Permission Overlay" });
        chips.push({ mod: "configuration", label: "Where configured → Configuration Explorer" });
      }
      if (c.kind === "flow") chips.push({ mod: "flowdocs", label: "How it works → Flow Analyzer" });
      if (c.objectApi) chips.push({ mod: "execution", label: "When automation runs → Execution Explorer" });
      return chips.length ? chips : [{ mod: "configuration", label: "Where configured → Configuration Explorer" }];
    }

    function prettyType(t) {
      return ({ CustomField: "Field", CustomObject: "Object", ApexClass: "Apex", ApexTrigger: "Trigger", ValidationRule: "Validation", FlexiPage: "Lightning Page", Flow: "Flow", LightningComponentBundle: "LWC", AuraDefinitionBundle: "Aura", DuplicateRule: "Duplicate Rule", WorkflowRule: "Workflow", ProcessDefinition: "Approval", Layout: "Layout", Report: "Report", EmailTemplate: "Email Template" })[t] || t;
    }
    function relation(t) {
      return ({ Flow: "Calls / references", ValidationRule: "References", ApexClass: "Calls / references", ApexTrigger: "References",
        Report: "Filters by / column", Layout: "Contains", FlexiPage: "Displays", EmailTemplate: "Merge field",
        LightningComponentBundle: "Displays / composes", AuraDefinitionBundle: "Displays / composes",
        CustomField: "Formula references", QuickActionDefinition: "Executes", WorkflowRule: "References",
        ProcessDefinition: "References", FieldSet: "Contains", DuplicateRule: "Uses", MatchingRule: "Uses", RecordType: "Assigns" })[t] || "References";
    }

    if (params && params.component) analyze(params.component);
  };

  Shell.register("impact", mod);
})();
