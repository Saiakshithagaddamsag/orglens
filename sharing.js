// MODULE 4 — Sharing Explorer. Question: "Why does this record become visible?"
(function () {
  const mod = {};
  const esc = (s) => Shell.esc(s);

  mod.mount = async (regions, params) => {
    let user = params.user || (Shell.handoff && Shell.handoff.user) || null;
    let objectApi = params.objectApi || (Shell.handoff && Shell.handoff.objectApi) || "Opportunity";

    const dg = await OrgAPI.describeGlobalCached().catch(() => ({ sobjects: [] }));
    const objs = dg.sobjects.filter((s) => s.queryable && s.searchable && s.layoutable).map((s) => s.name).sort();
    if (!objs.includes(objectApi)) objectApi = objs.includes("Opportunity") ? "Opportunity" : objs[0];

    function paint() {
      const row = Shell.searchRow(regions.search, {
        selects: [
          { id: "shObj", label: "Object", options: objs.map((o) => ({ v: o, t: o })), value: objectApi },
          { id: "shScope", label: "Scope", options: [{ v: "recent", t: "Recently viewed" }, { v: "all", t: "All records" }], value: "all" }
        ],
        placeholder: user
          ? "Search " + objectApi + " records by name (live query — records are data, not preloaded)…"
          : "First: search the user whose access you’re explaining…",
        buttonLabel: "Select",
        footNote: user
          ? "Searches all records of the object (standard + custom) · live query, no result limit"
          : "Searches all users · no result limit",
        fetchSuggestions: async (term) => {
          if (!user) {
            const r = await OrgAPI.query("SELECT Id, Name, Username, IsActive, UserRoleId, Profile.Name FROM User WHERE (Name LIKE '%" + OrgAPI.escLike(term) + "%' OR Username LIKE '%" + OrgAPI.escLike(term) + "%') AND IsActive = true ORDER BY Name");
            return r.records.map((u) => ({
              name: u.Name, badge: "USER", meta: (u.Profile ? u.Profile.Name : "") + " · " + u.Username,
              onPick: () => { user = u; paint(); Shell.toast("User set: " + u.Name + ". Now pick a record."); }
            }));
          }
          objectApi = row.selectValue("shObj");
          const d = await OrgAPI.cached("describe:" + objectApi, () => OrgAPI.describe(objectApi));
          const nameField = (d.fields.find((f) => f.nameField) || { name: "Name" }).name;
          const r = await OrgAPI.query("SELECT Id, " + nameField + " FROM " + objectApi + " WHERE " + nameField + " LIKE '%" + OrgAPI.escLike(term) + "%' ORDER BY " + nameField);
          return r.records.map((rec) => ({
            name: rec[nameField] || rec.Id, badge: objectApi.toUpperCase(),
            meta: rec.Id.slice(0, 3) + "…" + rec.Id.slice(-3),
            onPick: () => analyze(rec.Id, rec[nameField] || rec.Id)
          }));
        },
        onSubmit: () => {}
      });
      row.onSelectChange("shObj", (v) => { objectApi = v; });
      regions.results.innerHTML = user
        ? '<div class="note">Explaining access for <b>' + esc(user.Name) + "</b> · <button class=\"chip\" id=\"shSwapUser\">Change user</button></div>"
        : "";
      const swap = document.getElementById("shSwapUser");
      if (swap) swap.addEventListener("click", () => { user = null; paint(); });
    }
    paint();

    async function roleAncestry() {
      return OrgAPI.cached("roles", async () => {
        const r = await OrgAPI.query("SELECT Id, Name, ParentRoleId FROM UserRole");
        const map = {}; r.records.forEach((x) => (map[x.Id] = x));
        return map;
      });
    }
    function rollsUpTo(roles, ownerRoleId, userRoleId) {
      let cur = ownerRoleId, guard = 0;
      while (cur && guard++ < 100) {
        const parent = roles[cur] && roles[cur].ParentRoleId;
        if (parent === userRoleId) return true;
        cur = parent;
      }
      return false;
    }

    // Answers "is this user actually a member of that group?" by reading
    async function isMember(groupId, userId, userRoleId, depth, visited) {
      if (depth > 6 || (visited && visited.has(groupId))) return null;
      visited = visited || new Set(); visited.add(groupId);
      try {
        const g = (await OrgAPI.cached("group:" + groupId, () =>
          OrgAPI.query("SELECT Id, Type, RelatedId FROM Group WHERE Id = '" + groupId + "'"))).records[0];
        if (!g) return null;
        if (/Role/.test(g.Type) && g.RelatedId) {
          if (!userRoleId) return false;
          if (g.RelatedId === userRoleId) return true;
          if (g.Type === "RoleAndSubordinates" || g.Type === "RoleAndSubordinatesInternal") {
            const roles = await roleAncestry();
            let cur = userRoleId, guard = 0;
            while (cur && guard++ < 100) { if (cur === g.RelatedId) return true; cur = roles[cur] && roles[cur].ParentRoleId; }
          }
          return false;
        }
        const gm = await OrgAPI.cached("gm:" + groupId, () =>
          OrgAPI.query("SELECT UserOrGroupId FROM GroupMember WHERE GroupId = '" + groupId + "'"));
        for (const r of gm.records) if (r.UserOrGroupId === userId) return true;
        for (const r of gm.records) {
          if (!r.UserOrGroupId.startsWith("005")) {
            const nested = await isMember(r.UserOrGroupId, userId, userRoleId, depth + 1, visited);
            if (nested === true) return true;
          }
        }
        return false;
      } catch (e) { return null; }
    }

    async function analyze(recordId, recordName) {
      regions.analysis.innerHTML = Shell.spinner("Checking " + user.Name + "’s effective access via UserRecordAccess…");
      try {
        const ura = await OrgAPI.query(
          "SELECT RecordId, HasReadAccess, HasEditAccess, HasDeleteAccess, HasTransferAccess, HasAllAccess, MaxAccessLevel FROM UserRecordAccess WHERE UserId = '" + user.Id + "' AND RecordId = '" + OrgAPI.esc(recordId) + "'");
        const a = ura.records[0] || {};
        const lvl = [a.HasAllAccess && "All", a.HasEditAccess && "Read/Edit", a.HasReadAccess && "Read"].filter(Boolean)[0] || "None";

        // grant paths
        const paths = [];
        // 1 Ownership
        let ownerId = null, ownerRoleId = null;
        try {
          const rec = await OrgAPI.query("SELECT OwnerId FROM " + objectApi + " WHERE Id = '" + OrgAPI.esc(recordId) + "'");
          ownerId = rec.records[0] && rec.records[0].OwnerId;
          if (ownerId && ownerId.startsWith("005")) {
            const o = await OrgAPI.query("SELECT UserRoleId, Name FROM User WHERE Id = '" + ownerId + "'");
            ownerRoleId = o.records[0] && o.records[0].UserRoleId;
          }
          paths.push({
            n: 1, t: "Ownership", badge: Shell.badge("READABLE"),
            body: ownerId === user.Id
              ? "<b>" + esc(user.Name) + " owns this record</b> — owner-granted. " + Links.open(Links.record(recordId), "Open record")
              : "OwnerId ≠ " + esc(user.Name.split(" ")[0]) + " → not owner-granted. " + Links.open(ownerId ? Links.record(ownerId) : Links.record(recordId), "Open record owner")
          });
        } catch (e) {
          paths.push({ n: 1, t: "Ownership", badge: Shell.badge("UNAVAILABLE"), body: '<span class="muted">Your session cannot read this record’s owner.</span> ' + Links.open(Links.record(recordId), "Open record") });
        }
        try {
          const roles = await roleAncestry();
          if (ownerId === user.Id) {
            paths.push({ n: 2, t: "Role hierarchy", badge: Shell.badge("N/A", "b-mute"), body: '<span class="muted">Owner-granted — hierarchy not needed.</span>' });
          } else if (ownerRoleId && user.UserRoleId && rollsUpTo(roles, ownerRoleId, user.UserRoleId)) {
            paths.push({ n: 2, t: "Role hierarchy", badge: Shell.badge("LIKELY"), body: "Owner’s role rolls up to " + esc(user.Name.split(" ")[0]) + "’s role — likely grant; “Grant Access Using Hierarchies” for this object is not browser-readable. " + Links.open(Links.roles(), "Open Roles") });
          } else {
            paths.push({ n: 2, t: "Role hierarchy", badge: Shell.badge("LIKELY"), body: "Owner does not roll up directly under this user in the role tree Orglens read — exact rung needs review. " + Links.open(Links.roles(), "Open Roles") });
          }
        } catch (e) {
          paths.push({ n: 2, t: "Role hierarchy", badge: Shell.badge("UNAVAILABLE"), body: '<span class="muted">UserRole is not queryable from this session.</span> ' + Links.open(Links.roles(), "Open Roles") });
        }
        try {
          const owd = await OrgAPI.query("SELECT QualifiedApiName, InternalSharingModel, ExternalSharingModel FROM EntityDefinition WHERE QualifiedApiName = '" + OrgAPI.esc(objectApi) + "'");
          const m = owd.records[0];
          if (m && m.InternalSharingModel) {
            paths.push({ n: 3, t: "Org-Wide Default", badge: Shell.badge("READABLE"), body: "Internal OWD: <b>" + esc(m.InternalSharingModel) + "</b>" + (m.ExternalSharingModel ? " · External: <b>" + esc(m.ExternalSharingModel) + "</b>" : "") + " " + Links.open(Links.sharingSettings(), "Open Sharing Settings") });
          } else throw new Error("no model");
        } catch (e) {
          paths.push({ n: 3, t: "Org-Wide Default", badge: Shell.badge("UNAVAILABLE"), body: '<span class="muted">We can’t read OWD here — check it yourself:</span> ' + Links.open(Links.sharingSettings(), "Open Sharing Settings") });
        }
        // 4–7: share table (rules / manual / team / apex)
        let shareRows = null, shareErr = null;
        try {
          const shareName = objectApi.endsWith("__c") ? objectApi.replace(/__c$/, "__Share") : objectApi + "Share";
          const sd = await OrgAPI.cached("describe:" + shareName, () => OrgAPI.describe(shareName));
          const fk = sd.fields.find((f) => f.name === "ParentId") ? "ParentId" : (sd.fields.find((f) => f.name === objectApi + "Id") ? objectApi + "Id" : null);
          const acc = (sd.fields.find((f) => /AccessLevel$/.test(f.name) && f.name !== "RowCause") || {}).name;
          if (!fk || !acc) throw new Error("share shape unknown");
          const sh = await OrgAPI.query("SELECT UserOrGroupId, RowCause, " + acc + " FROM " + shareName + " WHERE " + fk + " = '" + OrgAPI.esc(recordId) + "'");
          shareRows = sh.records.map((r) => ({ who: r.UserOrGroupId, cause: r.RowCause, level: r[acc] }));
          // Resolve ids to names — a grant path should read "EMEA Sales (Public Group)", not an id.
          const ids = [...new Set(shareRows.map((r) => r.who).filter(Boolean))];
          const userIds = ids.filter((i) => i.startsWith("005"));
          const groupIds = ids.filter((i) => !i.startsWith("005"));
          const whoMap = {};
          if (userIds.length) {
            const ur = await OrgAPI.query("SELECT Id, Name FROM User WHERE Id IN (" + userIds.map((i) => "'" + i + "'").join(",") + ")").catch(() => ({ records: [] }));
            ur.records.forEach((x) => (whoMap[x.Id] = { name: x.Name, kind: "User", link: Links.user(x.Id) }));
          }
          if (groupIds.length) {
            const gr = await OrgAPI.query("SELECT Id, Name, Type, RelatedId FROM Group WHERE Id IN (" + groupIds.map((i) => "'" + i + "'").join(",") + ")").catch(() => ({ records: [] }));
            const kindOf = { Regular: "Public Group", Role: "Role", RoleAndSubordinates: "Role & subordinates", RoleAndSubordinatesInternal: "Role & internal subordinates", Queue: "Queue", Territory: "Territory", TerritoryAndSubordinates: "Territory & subordinates" };
            const roleIds = gr.records.filter((x) => /Role/.test(x.Type) && x.RelatedId).map((x) => x.RelatedId);
            const roleName = {};
            if (roleIds.length) {
              const rr = await OrgAPI.query("SELECT Id, Name FROM UserRole WHERE Id IN (" + [...new Set(roleIds)].map((i) => "'" + i + "'").join(",") + ")").catch(() => ({ records: [] }));
              rr.records.forEach((x) => (roleName[x.Id] = x.Name));
            }
            gr.records.forEach((x) => {
              const kind = kindOf[x.Type] || x.Type;
              const link = /Role/.test(x.Type) ? Links.roles() : /Territory/.test(x.Type) ? Links.territories()
                : x.Type === "Queue" ? Links.queues() : Links.lexBase() + "/lightning/setup/PublicGroups/home";
              const name = x.Name || (x.RelatedId && roleName[x.RelatedId]) || x.Id;
              whoMap[x.Id] = { name, kind, link };
            });
          }
          shareRows.forEach((r) => { r.whoInfo = whoMap[r.who] || null; });
          await Promise.all(shareRows.map(async (r) => {
            if (r.who && !r.who.startsWith("005") && r.who !== user.Id)
              r.member = await isMember(r.who, user.Id, user.UserRoleId, 0, null);
          }));
        } catch (e) { shareErr = e.message; }

        const causeRows = (pred) => (shareRows || []).filter(pred);
        const pendingTables = [];
        const renderShares = (allRows) => {
          // The question is "why does THIS user have access" — rows granting
          const rows = allRows.filter((r) =>
            r.who === user.Id || r.member === true ||
            (r.member !== false && !(r.whoInfo && r.whoInfo.kind === "User")));
          const others = allRows.length - rows.length;
          const othersNote = others
            ? '<div class="muted" style="margin-top:4px">' + others + " other share row" + (others === 1 ? "" : "s") +
              " on this record grant" + (others === 1 ? "s" : "") + " other users or groups " +
              esc(user.Name.split(" ")[0]) + " is not in — not their grant path. " +
              Links.open(Links.recordSharing(recordId), "Open record") + "</div>"
            : "";
          if (!rows.length) return '<span class="muted">No share rows here grant ' + esc(user.Name.split(" ")[0]) + " directly.</span>" + othersNote;
          if (rows.length > 10) {
            const id = "shPaged" + pendingTables.length;
            pendingTables.push({ id, rows });
            return '<div id="' + id + '"></div>' + othersNote;
          }
          return othersNote_wrap(rows, othersNote);
          function othersNote_wrap(rows, note) {
            return rows.map((r) => {
              const w = r.whoInfo;
              let who;
              if (r.who === user.Id) who = "<b>" + esc(user.Name) + " directly</b> " + Shell.badge("CONFIRMED");
              else if (w && r.member === true) who = "<b>" + esc(w.name) + "</b> <span class=\"muted\">(" + esc(w.kind) + " — " + esc(user.Name.split(" ")[0]) + " IS a member)</span> " + Shell.badge("CONFIRMED");
              else if (w) who = "<b>" + esc(w.name) + "</b> <span class=\"muted\">(" + esc(w.kind) + " — membership not readable from this session)</span> " + Shell.badge("LIKELY");
              else who = '<span class="mono">' + esc(r.who) + '</span> <span class="muted">(unresolvable from this session)</span> ' + Shell.badge("LIKELY");
              return '<div class="el-kv"><span class="pill-code">' + esc(r.cause) + "</span> → " + who +
                " · " + esc(r.level) + (w && w.link ? " " + Links.open(w.link) : "") + "</div>";
            }).join("") + note;
          }
        };
        const whoCell = (r) => {
          const w = r.whoInfo;
          if (r.who === user.Id) return "<b>" + esc(user.Name) + " directly</b>";
          if (!w) return '<span class="mono">' + esc(r.who) + "</span>";
          const mem = r.member === true ? " — member" : r.member === false ? " — NOT a member" : "";
          return "<b>" + esc(w.name) + "</b> <span class=\"muted\">(" + esc(w.kind || "User") + mem + ")</span>";
        };
        const memBadge = (r) => r.who === user.Id || r.member === true
          ? Shell.badge("CONFIRMED")
          : (r.whoInfo && r.whoInfo.kind === "User") || r.member === false ? Shell.badge("N/A", "b-mute") : Shell.badge("LIKELY");

        if (shareRows) {
          const rule = causeRows((r) => /Rule/.test(r.cause));
          paths.push({ n: 4, t: "Sharing rules", badge: rule.length ? Shell.badge("READABLE") : Shell.badge("READABLE"), body: rule.length ? renderShares(rule) : '<span class="muted">No rule-based share rows on this record.</span> ' + Links.open(Links.sharingSettings(), "Open Sharing Rules") });
          const man = causeRows((r) => r.cause === "Manual" || /Team/.test(r.cause));
          paths.push({ n: 5, t: "Manual & team shares", badge: Shell.badge("READABLE"), body: man.length ? renderShares(man) : '<span class="muted">No manual or team share rows.</span> ' + Links.open(Links.recordSharing(recordId), "Open record") });
          const terr = causeRows((r) => /Territory/.test(r.cause));
          paths.push({ n: 6, t: "Territory", badge: Shell.badge("READABLE"), body: terr.length ? renderShares(terr) : '<span class="muted">No territory share rows.</span> ' + Links.open(Links.territories(), "Open Territory Model") });
          const apx = causeRows((r) => !/Rule|Manual|Team|Owner|Territory|ImplicitParent|ImplicitChild/.test(r.cause));
          paths.push({ n: 7, t: "Apex managed sharing", badge: Shell.badge("READABLE"), body: apx.length ? renderShares(apx) : '<span class="muted">No Apex-managed share reasons.</span> ' + Links.open(Links.recordSharing(recordId), "Open record") });
        } else {
          paths.push({ n: 4, t: "Sharing rules", badge: Shell.badge("UNAVAILABLE"), body: '<span class="muted">Not readable in-browser (' + esc(shareErr || "") + ') — verify in Setup:</span> ' + Links.open(Links.sharingSettings(), "Open Sharing Rules") });
          paths.push({ n: 5, t: "Manual & team shares", badge: Shell.badge("UNAVAILABLE"), body: '<span class="muted">Check the record’s Sharing / team directly:</span> ' + Links.open(Links.recordSharing(recordId), "Open record") });
          paths.push({ n: 6, t: "Territory", badge: Shell.badge("UNAVAILABLE"), body: '<span class="muted">Verify in Setup:</span> ' + Links.open(Links.territories(), "Open Territory Model") });
          paths.push({ n: 7, t: "Apex managed sharing", badge: Shell.badge("UNAVAILABLE"), body: '<span class="muted">Programmatic — inspect the record’s share reasons:</span> ' + Links.open(Links.recordSharing(recordId), "Open record") });
        }

        const readableCount = paths.filter((p) => /READABLE|N\/A/.test(p.badge)).length;
        regions.analysis.innerHTML =
          Shell.analysisHead(esc(user.Name) + " · " + esc(recordName), Links.open(Links.record(recordId), "Open record")) +
          '<div class="verdict"><div class="verdict-line"><span class="' + (lvl !== "None" ? "yes\">✓" : "no\">✗") + '</span><b>' +
          esc(user.Name.split(" ")[0]) + (lvl !== "None" ? " can access this record" : " cannot access this record") + "</b> — " + esc(lvl) + "</div>" +
          '<div class="verdict-sub">The reason ' + (lvl !== "None" ? "they have it" : "it’s denied") + " is the hard part — grant paths that aren’t browser-readable are marked UNAVAILABLE, never guessed.</div></div>" +
          Shell.sectionLabel("Why does " + user.Name.split(" ")[0] + " have access? (grant paths, in evaluation order)") +
          paths.map((p) => Shell.layer({ num: p.n, title: p.t, statusBadge: p.badge, bodyHtml: p.body, dim: /UNAVAILABLE/.test(p.badge) })).join("") +
          Shell.bottomGrid(
            Shell.meter("Grant paths readable", Math.round((readableCount / paths.length) * 100)) +
            '<div class="note">Effective access is evidence (UserRecordAccess). Grant-path coverage is not evidence — never combined.</div>',
            [
              { mod: "permissions", label: "Object & field access → Permission Overlay" },
              { mod: "execution", label: "Automation on this object → Execution Explorer" }
            ]
          );
        for (const t of pendingTables) {
          const host = document.getElementById(t.id);
          if (host) Shell.resultsTable(host, {
            countLabel: t.rows.length + " share rows",
            columns: [{ h: "Cause", cls: "tname" }, { h: "Who" }, { h: "Access" }, { h: "", cls: "right" }],
            rows: t.rows.map((r) => ({
              cells: [esc(r.cause), whoCell(r) + " " + memBadge(r),
                esc(r.level), r.whoInfo && r.whoInfo.link ? Links.open(r.whoInfo.link) : ""]
            }))
          });
        }
      } catch (e) { regions.analysis.innerHTML = Shell.error(e.message); }
    }
  };

  Shell.register("sharing", mod);
})();
