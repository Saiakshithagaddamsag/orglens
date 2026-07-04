// Lightning deep links. Every reference opens directly in Lightning Experience —
(function () {
  const L = {};

  function lexBase() {
    const h = OrgAPI.host() || "";
    return "https://" + h.replace(/\.my\.salesforce\.com$/, ".lightning.force.com");
  }
  L.lexBase = lexBase;

  const setup = (node, address) =>
    lexBase() + "/lightning/setup/" + node + (address ? "/page?address=" + encodeURIComponent(address) : "/home");

  L.object = (apiName) => lexBase() + "/lightning/setup/ObjectManager/" + apiName + "/Details/view";
  L.objectFields = (apiName) => lexBase() + "/lightning/setup/ObjectManager/" + apiName + "/FieldsAndRelationships/view";
  // FieldDefinition.DurableId = "<Object>.<FieldIdOr Name>"
  L.field = (objectApi, fieldToken) =>
    lexBase() + "/lightning/setup/ObjectManager/" + objectApi + "/FieldsAndRelationships/" + fieldToken + "/view";
  L.validationRule = (objectApi, id) =>
    lexBase() + "/lightning/setup/ObjectManager/" + objectApi + "/ValidationRules/" + id + "/view";
  L.recordType = (objectApi, id) =>
    lexBase() + "/lightning/setup/ObjectManager/" + objectApi + "/RecordTypes/" + id + "/view";
  L.layoutView = (objectApi, layoutId) => lexBase() + "/lightning/setup/ObjectManager/" + objectApi + "/PageLayouts/" + layoutId + "/view";
  L.layouts = (objectApi) => lexBase() + "/lightning/setup/ObjectManager/" + objectApi + "/PageLayouts/view";
  L.compactLayouts = (objectApi) => lexBase() + "/lightning/setup/ObjectManager/" + objectApi + "/CompactLayouts/view";
  L.fieldSets = (objectApi) => lexBase() + "/lightning/setup/ObjectManager/" + objectApi + "/FieldSets/view";
  L.searchLayouts = (objectApi) => lexBase() + "/lightning/setup/ObjectManager/" + objectApi + "/SearchLayouts/view";
  L.lightningPages = (objectApi) => lexBase() + "/lightning/setup/ObjectManager/" + objectApi + "/LightningPages/view";
  L.triggersFor = (objectApi) => lexBase() + "/lightning/setup/ObjectManager/" + objectApi + "/ApexTriggers/view";

  // Flow Builder in Lightning
  L.flowVersion = (flowVersionId) => lexBase() + "/builder_platform_interaction/flowBuilder.app?flowId=" + flowVersionId;
  L.flowDefinition = (definitionId) => lexBase() + "/builder_platform_interaction/flowBuilder.app?flowDefId=" + definitionId;
  L.flowsHome = () => setup("Flows");

  L.apexClass = (id) => setup("ApexClasses", "/" + id);
  L.apexTrigger = (id) => setup("ApexTriggers", "/" + id);
  L.user = (id) => setup("ManageUsers", "/" + id + "?noredirect=1");
  L.profile = (id) => setup("EnhancedProfiles", "/" + id);
  L.permSet = (id) => setup("PermSets", "/" + id);
  L.roles = () => setup("Roles");
  L.sharingSettings = () => setup("SecuritySharing");
  L.territories = () => setup("Territory2Models");
  L.duplicateRules = () => setup("DuplicateRules");
  L.matchingRules = () => setup("MatchingRules");
  L.approvals = () => setup("ApprovalProcesses");
  L.workflows = () => setup("WorkflowRules");
  L.emailAlerts = () => setup("WorkflowEmails");
  L.queues = () => setup("Queues");
  L.leadAssignment = () => setup("LeadRules");
  L.caseAssignment = () => setup("CaseRules");
  L.tabs = () => setup("CustomTabs");
  L.appManager = () => setup("NavigationMenus");
  L.namedCredentials = () => setup("NamedCredential");
  L.connectedApps = () => setup("ConnectedApplication");
  L.customMetadata = () => setup("CustomMetadata");
  L.customSettings = () => setup("CustomSettings");
  L.globalValueSets = () => setup("Picklists");
  L.translations = () => setup("LabelWorkbenchTranslate");
  L.emailTemplates = () => lexBase() + "/lightning/o/EmailTemplate/home";
  L.reportsHome = () => lexBase() + "/lightning/o/Report/home";

  // Records & record-adjacent
  L.record = (id) => lexBase() + "/lightning/r/" + id + "/view";
  L.recordOf = (sobject, id) => lexBase() + "/lightning/r/" + sobject + "/" + id + "/view";
  L.report = (id) => lexBase() + "/lightning/r/Report/" + id + "/view";
  L.dashboard = (id) => lexBase() + "/lightning/r/Dashboard/" + id + "/view";
  L.recordSharing = (id) => lexBase() + "/lightning/r/" + id + "/view";

  // Best-effort router by dependency component type (Tooling MetadataComponentDependency)
  L.byType = (type, id, name, objectApi) => {
    switch ((type || "").toLowerCase()) {
      case "customfield": return objectApi ? L.field(objectApi, id) : L.flowsHome();
      case "customobject": return L.object(name || objectApi || "");
      case "apexclass": return L.apexClass(id);
      case "apextrigger": return L.apexTrigger(id);
      case "flow": return L.flowVersion(id);
      case "flowdefinition": return L.flowDefinition(id);
      case "validationrule": return objectApi ? L.validationRule(objectApi, id) : L.object(name || "");
      case "layout": return objectApi ? L.layouts(objectApi) : lexBase() + "/lightning/setup/ObjectManager/home";
      case "report": return L.report(id);
      case "dashboard": return L.dashboard(id);
      case "emailtemplate": return L.emailTemplates();
      case "quickaction": case "quickactiondefinition": return objectApi ? lexBase() + "/lightning/setup/ObjectManager/" + objectApi + "/ButtonsLinksActions/view" : setup("GlobalActions");
      case "recordtype": return objectApi ? L.recordType(objectApi, id) : lexBase() + "/lightning/setup/ObjectManager/home";
      case "compactlayout": return objectApi ? L.compactLayouts(objectApi) : lexBase() + "/lightning/setup/ObjectManager/home";
      case "fieldset": return objectApi ? L.fieldSets(objectApi) : lexBase() + "/lightning/setup/ObjectManager/home";
      case "flexipage": return objectApi ? L.lightningPages(objectApi) : setup("FlexiPageList");
      case "workflowrule": return L.workflows();
      case "lightningcomponentbundle": return lexBase() + "/lightning/setup/LightningComponentBundles/home";
      case "auradefinitionbundle": return lexBase() + "/lightning/setup/LightningComponentBundles/home";
      case "duplicaterule": return L.duplicateRules();
      case "user": return L.user(id);
      case "profile": return L.profile(id);
      case "permissionset": return L.permSet(id);
      default: return lexBase() + "/lightning/setup/SetupOneHome/home";
    }
  };

  L.open = (url, label) =>
    '<a href="' + url + '" target="_blank" rel="noopener">' + (label || "Open") + ' <span aria-hidden="true">↗</span></a>';

  window.Links = L;
})();
