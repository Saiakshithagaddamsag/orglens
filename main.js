// Bootstrap. Nothing about any org is hardcoded anywhere in Orglens:
(async function () {
  const tabs = Shell.el("tabs");
  const crumb = Shell.el("crumbInline");
  const homeBtn = Shell.el("homeBtn");

  function hashHost() {
    const m = location.hash.match(/host=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function toApi(h) {
    if (!h) return null;
    return h.replace(/\.lightning\.force\.com$/, ".my.salesforce.com")
            .replace(/\.my\.salesforce-setup\.com$/, ".my.salesforce.com");
  }

  let sessions;
  try { sessions = await new Promise((res, rej) => chrome.runtime.sendMessage({ op: "sessions" }, (r) => r && r.ok ? res(r.data) : rej(new Error(r ? r.error : "no bg")))); }
  catch (e) {
    Shell.el("regionSearch").innerHTML = '<div class="org-pick"><h3>Could not read Salesforce sessions</h3><div class="note">' + Shell.esc(e.message) + "</div></div>";
    return;
  }

  if (!sessions.length) {
    Shell.el("regionSearch").innerHTML =
      '<div class="org-pick"><h3>No Salesforce session found</h3><div class="note">Log in to a Salesforce org in another tab (Lightning), then reopen Orglens. Orglens is read-only and uses your existing session — it never asks for credentials.</div></div>';
    return;
  }

  sessions.sort((a, b) => a.host.localeCompare(b.host));
  const preferred = toApi(hashHost());
  let host = sessions.find((s) => s.host === preferred) ? preferred : (sessions[0] && sessions[0].host);

  tabs.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => Shell.activate(t.dataset.mod)));

  async function start(h) {
    OrgAPI.setHost(h);
    homeBtn.href = "https://" + h.replace(/\.my\.salesforce\.com$/, ".lightning.force.com") + "/lightning/page/home";
    crumb.textContent = "";
    Shell.el("whoAvatar").textContent = "";

    const [me, org] = await Promise.all([
      OrgAPI.currentUser().catch(() => ({ Name: "", Username: "" })),
      OrgAPI.cached("orgname", () => OrgAPI.query("SELECT Name, IsSandbox FROM Organization")).then((r) => r.records[0]).catch(() => null)
    ]);
    crumb.innerHTML = "/ <b>" + Shell.esc(me.Name || "") + "</b>" +
      (me.Username ? " / " + Shell.esc(me.Username) : "") +
      (org && org.Name ? " / " + Shell.esc(org.Name) : "");
    Shell.el("whoAvatar").textContent = (me.Name || "SF").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
    Shell.activate("impact");
  }

  start(host);
})();
