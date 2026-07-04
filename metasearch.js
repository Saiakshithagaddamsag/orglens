// Shared metadata component search. Queries run in parallel and are fully
(function () {
  const M = {};
  const A = () => window.OrgAPI;

  // Resolve custom-object durable Ids (TableEnumOrId of custom objects is an Id).
  async function customObjectMap() {
    return A().cached("customObjectMap", async () => {
      const r = await A().tooling("SELECT Id, DeveloperName, NamespacePrefix FROM CustomObject");
      const byId = {};
      for (const o of r.records) {
        byId[o.Id] = (o.NamespacePrefix ? o.NamespacePrefix + "__" : "") + o.DeveloperName + "__c";
      }
      return byId;
    });
  }

  M.TYPES = [
    { v: "all", t: "All component types" },
    { v: "object", t: "Objects" },
    { v: "field", t: "Fields (custom)" },
    { v: "flow", t: "Flows" },
    { v: "vr", t: "Validation rules" },
    { v: "apex", t: "Apex classes" },
    { v: "trigger", t: "Apex triggers" },
    { v: "emailtemplate", t: "Email templates" },
    { v: "lwc", t: "Lightning Web Components" },
    { v: "aura", t: "Aura components" },
    { v: "duprule", t: "Duplicate rules" },
    { v: "matchrule", t: "Matching rules" },
    { v: "recordtype", t: "Record types" },
    { v: "layout", t: "Page layouts" },
    { v: "lightningpage", t: "Lightning pages" }
  ];

  // Returns [{kind, badge, name, id, objectApi, meta, statusBadge, openUrl}]
  M.search = async (term, type) => {
    const t = A().escLike(term);
    const want = (k) => type === "all" || type === k;
    const jobs = [];

    if (want("object")) jobs.push(
      A().queryUnion([
        "SELECT DurableId, QualifiedApiName, Label FROM EntityDefinition WHERE QualifiedApiName LIKE '%" + t + "%' AND IsCustomizable = true LIMIT 2000",
        "SELECT DurableId, QualifiedApiName, Label FROM EntityDefinition WHERE Label LIKE '%" + t + "%' AND IsCustomizable = true LIMIT 2000"
      ], (o) => o.DurableId)
        .then((recs) => recs.sort((a, b) => a.QualifiedApiName.localeCompare(b.QualifiedApiName)).map((o) => ({
          kind: "object", badge: "OBJECT", name: o.QualifiedApiName, label: o.Label, id: o.DurableId,
          objectApi: o.QualifiedApiName, meta: o.Label, openUrl: Links.object(o.QualifiedApiName)
        }))).catch(() => []));

    if (want("field")) jobs.push(
      A().cached("allCustomFields", () =>
        A().tooling("SELECT Id, DeveloperName, TableEnumOrId, NamespacePrefix FROM CustomField").then((r) => r.records))
        .then(async (recs) => {
          const lt = term.toLowerCase();
          const map = await customObjectMap();
          return recs.filter((f) => (f.DeveloperName || "").toLowerCase().includes(lt)).map((f) => {
            const objectApi = map[f.TableEnumOrId] || f.TableEnumOrId;
            const api = (f.NamespacePrefix ? f.NamespacePrefix + "__" : "") + f.DeveloperName + "__c";
            return {
              kind: "field", badge: "FIELD", name: api, id: f.Id, objectApi,
              meta: objectApi, openUrl: Links.field(objectApi, f.Id)
            };
          });
        }).catch(() => []));

    if (want("flow")) {
      const FSEL = "SELECT DurableId, ApiName, Label, ProcessType, TriggerType, TriggerObjectOrEventLabel, RecordTriggerType, IsActive, ActiveVersionId, LatestVersionId, LastModifiedDate FROM FlowDefinitionView WHERE ";
      jobs.push(
        A().queryUnion([FSEL + "Label LIKE '%" + t + "%' ORDER BY Label", FSEL + "ApiName LIKE '%" + t + "%' ORDER BY ApiName"], (f) => f.DurableId)
          .then((recs) => recs.map((f) => ({
          kind: "flow", badge: "FLOW", name: f.Label || f.ApiName, id: f.ActiveVersionId || f.LatestVersionId,
          flow: f, objectApi: null,
          meta: [flowTypeLabel(f), f.TriggerObjectOrEventLabel, f.IsActive ? "Active" : "Inactive"].filter(Boolean).join(" · "),
          openUrl: Links.flowVersion(f.ActiveVersionId || f.LatestVersionId)
        }))).catch(() => []));
    }

    if (want("vr")) jobs.push(
      A().cached("allValidationRules", () =>
        A().tooling("SELECT Id, ValidationName, Active, EntityDefinition.QualifiedApiName FROM ValidationRule").then((r) => r.records))
        .then((recs) => {
          const lt = term.toLowerCase();
          return recs.filter((v) => (v.ValidationName || "").toLowerCase().includes(lt)).map((v) => ({
          kind: "vr", badge: "VALIDATION RULE", name: v.ValidationName, id: v.Id,
          objectApi: v.EntityDefinition && v.EntityDefinition.QualifiedApiName,
          meta: v.EntityDefinition && v.EntityDefinition.QualifiedApiName,
          openUrl: Links.validationRule(v.EntityDefinition && v.EntityDefinition.QualifiedApiName, v.Id)
        }));
        }).catch(() => []));

    if (want("apex")) jobs.push(
      A().query("SELECT Id, Name FROM ApexClass WHERE Name LIKE '%" + t + "%' ORDER BY Name")
        .then((r) => r.records.map((c) => ({
          kind: "apex", badge: "APEX CLASS", name: c.Name, id: c.Id, meta: "Apex Class", openUrl: Links.apexClass(c.Id)
        }))).catch(() => []));

    if (want("trigger")) jobs.push(
      A().query("SELECT Id, Name, TableEnumOrId FROM ApexTrigger WHERE Name LIKE '%" + t + "%' ORDER BY Name")
        .then((r) => r.records.map((c) => ({
          kind: "trigger", badge: "APEX TRIGGER", name: c.Name, id: c.Id, objectApi: c.TableEnumOrId,
          meta: c.TableEnumOrId, openUrl: Links.apexTrigger(c.Id)
        }))).catch(() => []));

    if (want("emailtemplate")) jobs.push(
      A().query("SELECT Id, Name, DeveloperName, IsActive FROM EmailTemplate WHERE Name LIKE '%" + t + "%'")
        .then((r) => r.records.map((e) => ({
          id: e.Id, name: e.Name, badge: "EMAIL TEMPLATE", type: "EmailTemplate",
          meta: (e.IsActive ? "Active" : "Inactive") + " · " + e.DeveloperName,
          openUrl: Links.emailTemplates ? Links.emailTemplates() : Links.lexBase() + "/lightning/setup/CommunicationTemplatesEmail/home"
        }))).catch(() => []));

    if (want("lwc")) jobs.push(
      A().cached("allLwc", () => A().tooling("SELECT Id, DeveloperName FROM LightningComponentBundle").then((r) => r.records))
        .then((recs) => recs.filter((c) => (c.DeveloperName || "").toLowerCase().includes(term.toLowerCase())).map((c) => ({
          id: c.Id, name: c.DeveloperName, badge: "LWC", type: "LightningComponentBundle",
          meta: "Lightning Web Component",
          openUrl: Links.lexBase() + "/lightning/setup/LightningComponentBundles/home"
        }))).catch(() => []));

    if (want("aura")) jobs.push(
      A().cached("allAura", () => A().tooling("SELECT Id, DeveloperName FROM AuraDefinitionBundle").then((r) => r.records))
        .then((recs) => recs.filter((c) => (c.DeveloperName || "").toLowerCase().includes(term.toLowerCase())).map((c) => ({
          id: c.Id, name: c.DeveloperName, badge: "AURA", type: "AuraDefinitionBundle",
          meta: "Aura component",
          openUrl: Links.lexBase() + "/lightning/setup/LightningComponentBundles/home"
        }))).catch(() => []));

    if (want("duprule")) jobs.push(
      A().query("SELECT Id, MasterLabel, DeveloperName, SobjectType, IsActive FROM DuplicateRule WHERE MasterLabel LIKE '%" + t + "%'")
        .then((r) => r.records.map((d) => ({
          id: d.Id, name: d.MasterLabel || d.DeveloperName, badge: "DUP RULE", type: "DuplicateRule",
          meta: (d.SobjectType || "") + " · " + (d.IsActive ? "Active" : "Inactive"),
          openUrl: Links.duplicateRules()
        }))).catch(() => []));

    if (want("matchrule")) jobs.push(
      A().query("SELECT Id, MasterLabel, SobjectType, RuleStatus FROM MatchingRule WHERE MasterLabel LIKE '%" + t + "%'")
        .then((r) => r.records.map((d) => ({
          id: d.Id, name: d.MasterLabel, badge: "MATCH RULE", type: "MatchingRule",
          meta: (d.SobjectType || "") + " · " + (d.RuleStatus || ""),
          openUrl: Links.matchingRules()
        }))).catch(() => []));

    if (want("recordtype")) jobs.push(
      A().query("SELECT Id, Name, SobjectType, IsActive FROM RecordType WHERE Name LIKE '%" + t + "%'")
        .then((r) => r.records.map((d) => ({
          id: d.Id, name: d.Name, badge: "RECORD TYPE", type: "RecordType", objectApi: d.SobjectType,
          meta: (d.SobjectType || "") + " · " + (d.IsActive ? "Active" : "Inactive"),
          openUrl: Links.recordType(d.SobjectType, d.Id)
        }))).catch(() => []));

    if (want("layout")) jobs.push(
      A().cached("allLayouts", () => A().tooling("SELECT Id, Name, TableEnumOrId FROM Layout").then((r) => r.records))
        .then((recs) => recs.filter((x) => (x.Name || "").toLowerCase().includes(term.toLowerCase())).map((x) => ({
          id: x.Id, name: x.Name, badge: "LAYOUT", type: "Layout", objectApi: x.TableEnumOrId,
          meta: x.TableEnumOrId || "",
          openUrl: Links.layoutView(x.TableEnumOrId, x.Id)
        }))).catch(() => []));

    if (want("lightningpage")) jobs.push(
      A().cached("allFlexiPages", () => A().tooling("SELECT Id, DeveloperName, MasterLabel, EntityDefinitionId, Type FROM FlexiPage").then((r) => r.records))
        .then((recs) => recs.filter((x) => ((x.MasterLabel || "") + " " + (x.DeveloperName || "")).toLowerCase().includes(term.toLowerCase())).map((x) => ({
          id: x.Id, name: x.MasterLabel || x.DeveloperName, badge: "LIGHTNING PAGE", type: "FlexiPage", objectApi: x.EntityDefinitionId,
          meta: (x.Type || "") + (x.EntityDefinitionId ? " · " + x.EntityDefinitionId : ""),
          openUrl: x.EntityDefinitionId ? Links.lightningPages(x.EntityDefinitionId) : Links.lexBase() + "/lightning/setup/FlexiPageList/home"
        }))).catch(() => []));

    const all = (await Promise.all(jobs)).flat();
    // deterministic: exact prefix matches first, then alphabetical
    const lt = term.toLowerCase();
    all.sort((a, b) => {
      const ap = a.name.toLowerCase().startsWith(lt) ? 0 : 1;
      const bp = b.name.toLowerCase().startsWith(lt) ? 0 : 1;
      return ap - bp || a.name.localeCompare(b.name);
    });
    return all;
  };

  function flowTypeLabel(f) {
    if (f.ProcessType === "Flow") return "Screen Flow";
    if (f.ProcessType === "AutoLaunchedFlow") {
      if (f.TriggerType === "RecordBeforeSave") return "Record Triggered · Before Save";
      if (f.TriggerType === "RecordAfterSave") return "Record Triggered · After Save";
      if (f.TriggerType === "RecordBeforeDelete") return "Record Triggered · Before Delete";
      if (f.TriggerType === "Scheduled") return "Scheduled";
      if (f.TriggerType === "PlatformEvent") return "Platform Event";
      return "Autolaunched";
    }
    return f.ProcessType || "Flow";
  }
  M.flowTypeLabel = flowTypeLabel;

  window.MetaSearch = M;
})();
