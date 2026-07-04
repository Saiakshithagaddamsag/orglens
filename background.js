

// Fallback: keep icon state in sync on tab switches and navigation.
function syncAction(tabId, url) {
  if (!tabId) return;
  const on = /https:\/\/[^/]*\.(salesforce|force|salesforce-setup)\.com\//.test(url || "");
  (on ? chrome.action.enable(tabId) : chrome.action.disable(tabId));
}
chrome.tabs.onActivated.addListener((info) =>
  chrome.tabs.get(info.tabId, (tab) => tab && syncAction(tab.id, tab.url)));
chrome.tabs.onUpdated.addListener((tabId, ch, tab) => {
  if (ch.status === "loading" || ch.url) syncAction(tabId, tab.url);
});
// Icon is enabled only on Salesforce tabs; grayed out everywhere else.
chrome.runtime.onInstalled.addListener(() => {
  chrome.action.disable();
  chrome.declarativeContent.onPageChanged.removeRules(undefined, () => {
    chrome.declarativeContent.onPageChanged.addRules([{
      conditions: [
        new chrome.declarativeContent.PageStateMatcher({ pageUrl: { hostSuffix: ".salesforce.com" } }),
        new chrome.declarativeContent.PageStateMatcher({ pageUrl: { hostSuffix: ".force.com" } }),
        new chrome.declarativeContent.PageStateMatcher({ pageUrl: { hostSuffix: ".salesforce-setup.com" } })
      ],
      actions: [new chrome.declarativeContent.ShowAction()]
    }]);
  });
});
// Orglens background service worker.

const API_VERSION = "v62.0";

chrome.action.onClicked.addListener(async (tab) => {
  // Prefer the org of the tab the user clicked from, if it is a Salesforce tab.
  let seed = "";
  try {
    if (tab && tab.url) {
      const u = new URL(tab.url);
      if (/\.(force|salesforce|salesforce-setup)\.com$/.test(u.hostname)) seed = u.hostname;
    }
  } catch (e) {}
  const url = chrome.runtime.getURL("app/index.html") + (seed ? "#host=" + encodeURIComponent(seed) : "");
  chrome.tabs.create({ url });
});

// Map any Salesforce hostname (lightning.force.com, salesforce-setup.com, my.salesforce.com)
function toApiHost(hostname) {
  if (!hostname) return null;
  let h = hostname;
  h = h.replace(/\.lightning\.force\.com$/, ".my.salesforce.com");
  h = h.replace(/\.my\.salesforce-setup\.com$/, ".my.salesforce.com");
  if (/\.my\.salesforce\.com$/.test(h)) return h;
  return null;
}

async function discoverSessions() {
  // Every usable API session is a "sid" cookie on a *.my.salesforce.com domain.
  const all = await chrome.cookies.getAll({ name: "sid" });
  const sessions = [];
  for (const c of all) {
    const domain = c.domain.replace(/^\./, "");
    if (/\.my\.salesforce\.com$/.test(domain)) {
      sessions.push({
        host: domain,
        isSandbox: /\.sandbox\.my\.salesforce\.com$/.test(domain),
        _sid: c.value
      });
    }
  }
  return sessions;
}

const sidCache = new Map();

async function sidFor(host) {
  if (sidCache.has(host)) return sidCache.get(host);
  const c = await chrome.cookies.get({ url: "https://" + host + "/", name: "sid" });
  if (!c) throw new Error("No Salesforce session for " + host + ". Log in to the org in another tab, then retry.");
  sidCache.set(host, c.value);
  return c.value;
}

async function sfGet(host, path) {
  const sid = await sidFor(host);
  const res = await fetch("https://" + host + path, {
    method: "GET",
    headers: { Authorization: "Bearer " + sid, "Content-Type": "application/json" }
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch (e) { body = text; }
  if (res.status === 401) { sidCache.delete(host); throw new Error("SESSION_EXPIRED"); }
  if (!res.ok) {
    const msg = Array.isArray(body) ? (body[0] && (body[0].message || body[0].errorCode)) : String(text).slice(0, 300);
    const err = new Error(msg || ("HTTP " + res.status));
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

// Fully paginated query — walks nextRecordsUrl until exhausted. No result limit.
async function queryAllPages(host, soql, tooling) {
  const base = "/services/data/" + API_VERSION + (tooling ? "/tooling" : "") + "/query/?q=" + encodeURIComponent(soql);
  let page = await sfGet(host, base);
  const records = page.records || [];
  let guard = 0;
  while (!page.done && page.nextRecordsUrl && guard < 500) {
    page = await sfGet(host, page.nextRecordsUrl);
    records.push(...(page.records || []));
    guard++;
  }
  return { records, totalSize: records.length };
}

const handlers = {
  sessions: async () => (await discoverSessions()).map(({ _sid, ...s }) => s),
  query: (m) => queryAllPages(m.host, m.soql, false),
  toolingQuery: (m) => queryAllPages(m.host, m.soql, true),
  get: (m) => sfGet(m.host, m.path),
  toolingGet: (m) => sfGet(m.host, "/services/data/" + API_VERSION + "/tooling" + m.path),
  search: (m) => sfGet(m.host, "/services/data/" + API_VERSION + "/search/?q=" + encodeURIComponent(m.sosl)),
  describe: (m) => sfGet(m.host, "/services/data/" + API_VERSION + "/sobjects/" + m.sobject + "/describe/"),
  describeGlobal: (m) => sfGet(m.host, "/services/data/" + API_VERSION + "/sobjects/"),
  apiVersion: async () => API_VERSION
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const fn = handlers[msg && msg.op];
  if (!fn) { sendResponse({ ok: false, error: "Unknown op" }); return false; }
  Promise.resolve(fn(msg))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ ok: false, error: e.message || String(e) }));
  return true;
});
