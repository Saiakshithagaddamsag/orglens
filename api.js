// API layer. All calls are GETs proxied through the service worker.
(function () {
  const API = {};
  let HOST = null;

  function call(op, extra) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(Object.assign({ op, host: HOST }, extra || {}), (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res) return reject(new Error("No response from background"));
        if (!res.ok) return reject(new Error(res.error));
        resolve(res.data);
      });
    });
  }

  API.setHost = (h) => { HOST = h; };
  API.host = () => HOST;
  API.isSandbox = () => /\.sandbox\.my\.salesforce\.com$/.test(HOST || "");
  API.sessions = () => call("sessions");

  // Escape a user-typed value for use inside a SOQL string literal / LIKE.
  API.esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  API.escLike = (s) => API.esc(s).replace(/%/g, "\\%").replace(/_/g, "\\_");

  // Fully paginated — background walks nextRecordsUrl to exhaustion. No result limit.
  API.query = (soql) => call("query", { soql });
  API.tooling = (soql) => call("toolingQuery", { soql });
  API.toolingGet = (path) => call("toolingGet", { path });
  API.get = (path) => call("get", { path });
  API.search = (sosl) => call("search", { sosl });
  API.describe = (sobject) => call("describe", { sobject });

  const memo = new Map();
  // Cache metadata only (never record-level results). Keyed per org host.
  API.cached = async (key, fn) => {
    const k = HOST + "::" + key;
    if (memo.has(k)) return memo.get(k);
    const p = fn().catch((e) => { memo.delete(k); throw e; });
    memo.set(k, p);
    return p;
  };

  API.describeGlobalCached = () => API.cached("describeGlobal", () => call("describeGlobal"));

  // Some setup entities (FlowDefinitionView, EntityDefinition, …) reject OR /
  API.queryUnion = async (soqls, keyOf) => {
    const results = await Promise.all(soqls.map((q) => API.query(q).catch(() => ({ records: [] }))));
    const seen = new Set(); const out = [];
    for (const r of results) for (const rec of r.records) {
      const k = keyOf(rec);
      if (!seen.has(k)) { seen.add(k); out.push(rec); }
    }
    return out;
  };

  API.currentUser = () => API.cached("me", async () => {
    try {
      const me = await API.get("/services/data/v62.0/chatter/users/me");
      return { Id: me.id, Name: me.displayName || me.name, Username: me.username };
    } catch (e) {
      return { Id: null, Name: "Salesforce user", Username: "" };
    }
  });

  window.OrgAPI = API;
})();
