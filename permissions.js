// MODULE 1 — Permission Overlay. Question: "Can this user perform this action?"
(function () {
  const mod = {};

  mod.mount = async (regions, params) => {
    let profiles = [{ v: "all", t: "All profiles" }];
    OrgAPI.cached("profiles", () => OrgAPI.query("SELECT Id, Name FROM Profile ORDER BY Name")).then((r) => {
      profiles.push(...r.records.map((p) => ({ v: p.Id, t: p.Name })));
      // repaint select options in place
      const sel = document.getElementById("permProfile");
      if (sel) sel.innerHTML = profiles.map((o) => '<option value="' + o.v + '">' + Shell.esc(o.t) + "</option>").join("");
    }).catch(() => {});

    const row = Shell.searchRow(regions.search, {
      selects: [
        { id: "permActive", label: "User scope", options: [{ v: "active", t: "Active" }, { v: "all", t: "All" }], value: "active" },
        { id: "permProfile", label: "Profile", options: profiles, value: "all" }
      ],
      placeholder: "Search users by name or username…",
      buttonLabel: "Select",
      footNote: "Searches all standard + custom in the " + (OrgAPI.isSandbox() ? "sandbox" : "org") + " · no result limit",
      fetchSuggestions: async (term) => {
        const users = await searchUsers(term);
        return users.map((u) => ({
          name: u.Name, badge: "USER",
          meta: (u.Profile ? u.Profile.Name : "") + (u.Username ? " · " + u.Username : ""),
          onPick: () => pickUser(u)
        }));
      },
      onSubmit: (term) => term && listUsers(term)
    });

    async function searchUsers(term) {
      const t = OrgAPI.escLike(term);
      const active = row.selectValue("permActive") === "active" ? " AND IsActive = true" : "";
      const prof = row.selectValue("permProfile") !== "all" ? " AND ProfileId = '" + OrgAPI.esc(row.selectValue("permProfile")) + "'" : "";
      const r = await OrgAPI.query(
        "SELECT Id, Name, Username, IsActive, ProfileId, Profile.Name, UserRoleId FROM User WHERE (Name LIKE '%" + t + "%' OR Username LIKE '%" + t + "%')" + active + prof + " ORDER BY Name"
      );
      return r.records;
    }

    async function listUsers(term) {
      regions.results.innerHTML = Shell.spinner("Searching all users…");
      try {
        const users = await searchUsers(term);
        Shell.resultsTable(regions.results, {
          countLabel: users.length + " users",
          columns: [{ h: "Name", cls: "tname" }, { h: "Username" }, { h: "Profile" }, { h: "Status" }, { h: "", cls: "right" }],
          rows: users.map((u) => ({
            cells: [Shell.esc(u.Name), '<span class="mono">' + Shell.esc(u.Username) + "</span>",
              Shell.esc(u.Profile ? u.Profile.Name : "—"),
              u.IsActive ? Shell.badge("Active", "b-active") : Shell.badge("Inactive"),
              Links.open(Links.user(u.Id))],
            onClick: () => pickUser(u)
          }))
        });
      } catch (e) { regions.results.innerHTML = Shell.error(e.message); }
    }

    let ctx = { user: null, objectApi: params.objectApi || null, fieldName: params.fieldName || null };

    async function pickUser(u) {
      ctx.user = u;
      regions.analysis.innerHTML = Shell.spinner("Loading objects…");
      const dg = await OrgAPI.describeGlobalCached();
      const objs = dg.sobjects.filter((s) => s.queryable && s.layoutable).map((s) => s.name).sort();
      const objOpts = objs.map((o) => '<option value="' + o + '"' + (o === ctx.objectApi ? " selected" : "") + ">" + o + "</option>").join("");
      regions.analysis.innerHTML =
        Shell.analysisHead(Shell.esc(u.Name), Links.open(Links.user(u.Id), "Open user")) +
        '<div class="search-row">' +
        '<div class="select"><select id="permObj" aria-label="Object">' + objOpts + "</select></div>" +
        '<div class="select"><select id="permField" aria-label="Field"><option value="">Entire Object</option></select></div>' +
        '<button class="primary-btn" id="permEval">Evaluate</button></div>' +
        '<div id="permOut"></div>';

      const objSel = document.getElementById("permObj");
      const fldSel = document.getElementById("permField");
      async function loadFields() {
        fldSel.innerHTML = '<option value="">Entire Object</option>';
        try {
          const d = await OrgAPI.cached("describe:" + objSel.value, () => OrgAPI.describe(objSel.value));
          fldSel.innerHTML += d.fields.map((f) =>
            '<option value="' + f.name + '"' + (f.name === ctx.fieldName ? " selected" : "") + ">" + f.name + "</option>").join("");
        } catch (e) {}
      }
      objSel.addEventListener("change", loadFields);
      await loadFields();
      document.getElementById("permEval").addEventListener("click", () => evaluate(u, objSel.value, fldSel.value || null));
      if (ctx.objectApi) evaluate(u, objSel.value, fldSel.value || null);
    }

    async function evaluate(u, objectApi, fieldName) {
      Shell.handoff = { user: u, objectApi, fieldName };
      const out = document.getElementById("permOut");
      out.innerHTML = Shell.spinner("Evaluating L1 → L6 in order…");
      try {
        // ---- L1: system permissions via all permission-set assignments (profile-owned included)
        const psa = await OrgAPI.query(
          "SELECT PermissionSetId, PermissionSet.Name, PermissionSet.Label, PermissionSet.IsOwnedByProfile, PermissionSet.Profile.Name, " +
          "PermissionSet.PermissionsModifyAllData, PermissionSet.PermissionsViewAllData, PermissionSet.PermissionsCustomizeApplication, " +
          "PermissionSet.PermissionsApiEnabled, PermissionSet.PermissionsManageUsers, PermissionSet.PermissionsAuthorApex, PermissionSet.PermissionsViewSetup, " +
          "PermissionSetGroupId FROM PermissionSetAssignment WHERE AssigneeId = '" + u.Id + "' AND IsActive = true"
        );
        const psIds = psa.records.map((r) => r.PermissionSetId);
        const psgIds = [...new Set(psa.records.map((r) => r.PermissionSetGroupId).filter(Boolean))];
        const psgName = {};
        const psgMembers = {};
        if (psgIds.length) {
          const idList = psgIds.map((x) => "'" + x + "'").join(",");
          const pg = await OrgAPI.query("SELECT Id, MasterLabel FROM PermissionSetGroup WHERE Id IN (" + idList + ")").catch(() => ({ records: [] }));
          pg.records.forEach((g) => (psgName[g.Id] = g.MasterLabel));
          const pc = await OrgAPI.query("SELECT PermissionSetGroupId, PermissionSetId, PermissionSet.Label FROM PermissionSetGroupComponent WHERE PermissionSetGroupId IN (" + idList + ")").catch(() => ({ records: [] }));
          pc.records.forEach((r) => {
            const label = r.PermissionSet ? (r.PermissionSet.Label || r.PermissionSet.Name) : "(Muting Permission Set)";
            (psgMembers[r.PermissionSetGroupId] = psgMembers[r.PermissionSetGroupId] || []).push({ id: r.PermissionSetId, label });
          });
        }
        const grantName = (r) => !r.PermissionSet ? "(unreadable permission set)" : r.PermissionSet.IsOwnedByProfile
          ? "Profile: " + (r.PermissionSet.Profile ? r.PermissionSet.Profile.Name : "")
          : "PS: " + (r.PermissionSet.Label || r.PermissionSet.Name);
        const sys = (flag) => psa.records.filter((r) => r.PermissionSet && r.PermissionSet["Permissions" + flag]);
        const mad = sys("ModifyAllData"), vad = sys("ViewAllData");

        // ---- L2: object CRUD
        const inIds = psIds.map((i) => "'" + i + "'").join(",") || "''";
        const op = await OrgAPI.query(
          "SELECT ParentId, Parent.Label, Parent.IsOwnedByProfile, Parent.Profile.Name, PermissionsCreate, PermissionsRead, PermissionsEdit, PermissionsDelete, PermissionsViewAllRecords, PermissionsModifyAllRecords " +
          "FROM ObjectPermissions WHERE SobjectType = '" + OrgAPI.esc(objectApi) + "' AND ParentId IN (" + inIds + ")"
        );
        const crud = { Create: false, Read: false, Edit: false, Delete: false, ViewAll: false, ModifyAll: false };
        const crudSources = [];
        for (const r of op.records) {
          if (r.PermissionsCreate) crud.Create = true;
          if (r.PermissionsRead) crud.Read = true;
          if (r.PermissionsEdit) crud.Edit = true;
          if (r.PermissionsDelete) crud.Delete = true;
          if (r.PermissionsViewAllRecords) crud.ViewAll = true;
          if (r.PermissionsModifyAllRecords) crud.ModifyAll = true;
          if (!r.Parent) continue;
          const grants = [r.PermissionsCreate && "Create", r.PermissionsRead && "Read", r.PermissionsEdit && "Edit", r.PermissionsDelete && "Delete", r.PermissionsViewAllRecords && "View All", r.PermissionsModifyAllRecords && "Modify All"].filter(Boolean);
          if (grants.length) crudSources.push({
            name: r.Parent.IsOwnedByProfile ? "Profile: " + (r.Parent.Profile ? r.Parent.Profile.Name : "") : "PS: " + r.Parent.Label,
            isProfile: r.Parent.IsOwnedByProfile, id: r.ParentId, grants
          });
        }
        crudSources.sort((a, b) => (b.isProfile - a.isProfile) || a.name.localeCompare(b.name));
        for (const r of mad) crudSources.unshift({
          name: grantName(r) + " — Modify All Data (system permission, bypasses object permissions)",
          isProfile: r.PermissionSet.IsOwnedByProfile, id: r.PermissionSetId,
          grants: ["Create", "Read", "Edit", "Delete"]
        });
        for (const r of vad) crudSources.unshift({
          name: grantName(r) + " — View All Data (system permission)",
          isProfile: r.PermissionSet.IsOwnedByProfile, id: r.PermissionSetId,
          grants: ["Read"]
        });
        if (mad.length) { crud.Create = crud.Read = crud.Edit = crud.Delete = true; }
        if (vad.length) crud.Read = true;

        // ---- L3: field security, merged, plus metadata read-only from describe
        const fp = await OrgAPI.query(
          "SELECT Field, PermissionsRead, PermissionsEdit, Parent.Label, Parent.IsOwnedByProfile, Parent.Profile.Name " +
          "FROM FieldPermissions WHERE SobjectType = '" + OrgAPI.esc(objectApi) + "' AND ParentId IN (" + inIds + ")"
        );
        const desc = await OrgAPI.cached("describe:" + objectApi, () => OrgAPI.describe(objectApi));
        const fls = new Map();
        for (const r of fp.records) {
          if (!r.Parent) continue;
          const f = r.Field.split(".").pop();
          const e = fls.get(f) || { read: false, edit: false, sources: new Set() };
          if (r.PermissionsRead) { e.read = true; e.sources.add(r.Parent.IsOwnedByProfile ? "Profile" : "PS: " + r.Parent.Label); }
          if (r.PermissionsEdit) e.edit = true;
          fls.set(f, e);
        }
        const fieldRows = desc.fields.map((f) => {
          const e = fls.get(f.name);
          // FLS rows exist only for permissionable fields; non-permissionable standard fields inherit object access.
          let read = e ? e.read : (crud.Read && !f.permissionable ? true : e ? e.read : crud.Read && f.permissionable === false);
          if (e) read = e.read; else read = crud.Read && f.permissionable === false;
          let edit = e ? e.edit : (crud.Edit && f.permissionable === false && f.updateable);
          if (mad.length) { read = true; edit = edit || f.updateable; }
          let reason = e ? "Profile + PS" : (f.permissionable === false ? "Not permissionable — follows object access" : "No FLS grant");
          let metaRO = null;
          if (f.calculated) { metaRO = "Formula"; edit = false; reason = "Formula — metadata, not FLS"; }
          else if (f.autoNumber) { metaRO = "Auto Number"; edit = false; reason = "Auto Number — metadata, not FLS"; }
          else if (!f.updateable && read) { if (!e || !e.edit) { edit = false; } }
          if (e && !e.edit && !metaRO) reason = e.read ? "FLS denies Edit" : "FLS denies Read";
          return { f, read: !!read, edit: !!edit, reason, metaRO };
        });
        const focus = fieldName ? fieldRows.find((r) => r.f.name === fieldName) : null;
        fieldRows.sort((a, b) =>
          (a.f.name === fieldName ? -1 : 0) - (b.f.name === fieldName ? -1 : 0) || a.f.name.localeCompare(b.f.name));

        // ---- L6 readable part: which page layout this user's PROFILE is assigned
        let layoutAssign = null;
        try {
          const pl0 = await OrgAPI.tooling(
            "SELECT Id, LayoutId, RecordTypeId, TableEnumOrId FROM ProfileLayout WHERE ProfileId = '" + u.ProfileId + "'");
          const pl = { records: pl0.records.filter((r) => r.TableEnumOrId === objectApi) };
          if (pl.records.length) {
            const layIds = [...new Set(pl.records.map((r) => r.LayoutId))].map((i) => "'" + i + "'").join(",");
            const lay = await OrgAPI.tooling("SELECT Id, Name FROM Layout WHERE Id IN (" + layIds + ")");
            const layName = {}; lay.records.forEach((l) => (layName[l.Id] = l.Name));
            const rtIds = [...new Set(pl.records.map((r) => r.RecordTypeId).filter(Boolean))];
            let rtName = {};
            if (rtIds.length) {
              const rt = await OrgAPI.query("SELECT Id, Name FROM RecordType WHERE Id IN (" + rtIds.map((i) => "'" + i + "'").join(",") + ")").catch(() => ({ records: [] }));
              rt.records.forEach((r) => (rtName[r.Id] = r.Name));
            }
            layoutAssign = pl.records.map((r) => ({
              layoutId: r.LayoutId,
              layout: layName[r.LayoutId] || r.LayoutId,
              rt: r.RecordTypeId ? (rtName[r.RecordTypeId] || r.RecordTypeId) : "Master (no record type)"
            })).sort((a, b) => a.rt.localeCompare(b.rt));
          }
        } catch (e) { layoutAssign = null; }

        // ---- L5 partial: frozen / inactive readable; login hours & IP not
        let frozen = null;
        try {
          const ul = await OrgAPI.query("SELECT Id, IsFrozen FROM UserLogin WHERE UserId = '" + u.Id + "'");
          frozen = ul.records.length ? ul.records[0].IsFrozen : null;
        } catch (e) {}

        // ---- verdict
        const title = Shell.esc(u.Name) + " · " + Shell.esc(objectApi) + (fieldName ? " · " + Shell.esc(fieldName) : "");
        let verdict = "";
        verdict += '<div class="verdict-line"><span class="' + (crud.Edit ? "yes\">✓" : "no\">✗") + '</span><b>' +
          (crud.Edit ? "Can edit " : "Cannot edit ") + Shell.esc(objectApi) + "</b> — " +
          (crud.Edit ? "object-level Edit granted" : "no Edit grant on any profile or permission set") + "</div>";
        if (focus) {
          const ok = focus.edit;
          verdict += '<div class="verdict-line"><span class="' + (ok ? "yes\">✓" : "no\">✗") + '</span><b>' +
            Shell.esc(fieldName) + (ok ? " can be edited" : " cannot be edited") + "</b> — " + Shell.esc(focus.reason) +
            " " + Shell.badge("CONFIRMED") + "</div>";
        }

        out.innerHTML =
          Shell.analysisHead(title, Links.open(Links.user(u.Id), "Open user")) +
          '<div class="verdict">' + verdict + "</div>" +
          Shell.sectionLabel("Authorization layers (in order)") +
          Shell.layer({
            num: "L1", title: "System Permissions", statusBadge: Shell.badge("CONFIRMED"),
            bodyHtml:
              "Modify All Data " + (mad.length ? "<b>on</b> via " + Shell.esc(mad.map(grantName).join(", ")) + " — bypasses lower layers." : "off") +
              " · View All Data " + (vad.length ? "<b>on</b> via " + Shell.esc(vad.map(grantName).join(", ")) : "off") +
              (mad.length || vad.length ? "" : " — lower layers not bypassed.") +
              " " + Links.open(Links.user(u.Id)) +
              '<div class="io-group-name" style="margin-top:8px">All ' + psa.records.length + ' active assignments (profile-owned included)</div><div id="l1Paged"></div>' 
          }) +
          Shell.layer({
            num: "L2", title: "Object Access (CRUD)", statusBadge: Shell.badge("CONFIRMED"),
            bodyHtml:
              ["Create", "Read", "Edit", "Delete"].map((k) =>
                k + " " + (crud[k] ? '<span class="check">✓</span>' : '<span class="cross">✗</span>')).join(" &nbsp; ") +
              (crud.ViewAll ? " &nbsp; View All ✓" : "") + (crud.ModifyAll ? " &nbsp; Modify All ✓" : "") +
              '<div class="io-group-name" style="margin-top:8px">Granted by (' + crudSources.length + " source" + (crudSources.length === 1 ? "" : "s") + ')</div><div id="l2Paged"></div>' +
              '<div class="muted" style="margin-top:4px">' + (psa.records.length - new Set(op.records.map((r) => r.ParentId)).size) + " of the user\'s " + psa.records.length + " assigned permission sets grant no object permissions on " + Shell.esc(objectApi) + " — the full assignment list is under L1.</div>" +
              '<div class="muted" style="margin-top:4px">' + Links.open(Links.object(objectApi)) + "</div>"
          }) +
          Shell.layer({
            num: "L3", title: "Field Security", statusBadge: Shell.badge("CONFIRMED"),
            bodyHtml: '<div id="flsPaged"></div>' +
              '<div class="muted" style="margin-top:6px">All ' + fieldRows.length +
              " fields (focused + restricted first). Formula / Auto Number / calculated fields are read-only by metadata, not FLS.</div>"
          }) +
          Shell.layer({
            num: "L4", title: "Record Access", statusBadge: Shell.badge("needs record"), dim: true,
            bodyHtml: 'Record-level access needs a specific record. <button class="chip" data-goto="sharing">Evaluate a record → Sharing</button>'
          }) +
          Shell.layer({
            num: "L5", title: "Runtime Restrictions",
            statusBadge: frozen === null ? Shell.badge("UNAVAILABLE") : Shell.badge("PARTIAL"),
            dim: frozen === null,
            bodyHtml:
              (frozen === null ? "" :
                "User is " + (u.IsActive ? "<b>active</b>" : "<b>inactive</b>") + (frozen ? " and <b>frozen</b>" : " and not frozen") + " " + Shell.badge("CONFIRMED") + ". ") +
              '<span class="muted">Approval locks need a record. Login hours and IP ranges are Metadata-API-only — not readable from this session.</span> ' +
              Shell.badge("UNAVAILABLE") + " " + Links.open(Links.profile(u.ProfileId || ""), "Open profile")
          }) +
          Shell.layer({
            num: "L6", title: "Presentation (NOT security)", statusBadge: layoutAssign ? Shell.badge("PARTIAL") : Shell.badge("UNAVAILABLE"), dim: !layoutAssign,
            bodyHtml:
              (layoutAssign
                ? '<div class="io-group-name">Page layout assignments for ' + Shell.esc(u.Profile ? u.Profile.Name : "this profile") + ' (readable · Tooling)</div><div id="l6Paged"></div>'
                : "") +
              '<div class="muted" style="margin-top:6px">Layouts and component visibility only hide UI — they never grant or deny access. Dynamic Form visibility rules are not browser-readable; Orglens will not guess them.</div> ' +
              Links.open(Links.lightningPages(objectApi))
          }) +
          Shell.bottomGrid(
            Shell.meter("L1–L3 evidence", 100) + Shell.meter("L4–L6 readable here", frozen === null ? 0 : 17) +
            '<div class="note">Coverage is not evidence: every ✓/✗ above cites its grant source; UNAVAILABLE layers are gaps, not denials.</div>',
            [
              { mod: "sharing", label: "Record access → Sharing Explorer" },
              { mod: "configuration", label: "Where configured → Configuration Explorer" },
              { mod: "impact", label: "What depends on this → Impact Analyzer" }
            ]
          );
        const l1Host = document.getElementById("l1Paged");
        if (l1Host) Shell.resultsTable(l1Host, {
          countLabel: psa.records.length + " assignments",
          columns: [{ h: "Source", cls: "tname" }, { h: "Type" }, { h: "", cls: "right" }],
          rows: psa.records
            .slice()
            .sort((a, b) => (((b.PermissionSet || {}).IsOwnedByProfile ? 1 : 0) - (((a.PermissionSet || {}).IsOwnedByProfile ? 1 : 0))) || grantName(a).localeCompare(grantName(b)))
            .flatMap((r) => {
              if (r.PermissionSetGroupId) {
                const gid = r.PermissionSetGroupId;
                const label = psgName[gid] || (r.PermissionSet ? r.PermissionSet.Label : gid);
                const members = psgMembers[gid] || [];
                const parent = { cells: [
                  '<button class="caret" data-psg="' + gid + '">▸</button> <b>PSG: ' + Shell.esc(label) + "</b>" +
                    (members.length ? ' <span class="badge b-mute">' + members.length + " sets</span>" : ""),
                  "Permission Set Group",
                  Links.open(Links.lexBase() + "/lightning/setup/PermSetGroups/page?address=%2F" + gid)] };
                const kids = members.map((m) => ({
                  cls: "psg-child row-hidden psg-" + gid,
                  cells: ['<span class="psg-ind">↳</span> ' + Shell.esc(m.label), "Permission Set (in group)", Links.open(Links.permSet(m.id))]
                }));
                return [parent, ...kids];
              }
              const owned = r.PermissionSet && r.PermissionSet.IsOwnedByProfile;
              const type = owned ? "Profile" : "Permission Set";
              const link = owned ? Links.profile(r.PermissionSetId) : Links.permSet(r.PermissionSetId);
              return [{ cells: [Shell.esc(grantName(r)), type, Links.open(link)] }];
            })
        });
        if (l1Host && !l1Host.dataset.psgWired) {
          l1Host.dataset.psgWired = "1";
          l1Host.addEventListener("click", (ev) => {
            const btn = ev.target.closest(".caret");
            if (!btn) return;
            const open = btn.textContent === "▾";
            btn.textContent = open ? "▸" : "▾";
            l1Host.querySelectorAll("tr.psg-" + btn.getAttribute("data-psg"))
              .forEach((tr) => tr.classList.toggle("row-hidden", open));
          });
        }
        const l2Host = document.getElementById("l2Paged");
        if (l2Host) Shell.resultsTable(l2Host, {
          countLabel: crudSources.length + " grant sources",
          columns: [{ h: "Source", cls: "tname" }, { h: "Grants" }, { h: "", cls: "right" }],
          rows: crudSources.length ? crudSources.map((s) => ({
            cells: [Shell.esc(s.name), Shell.esc(s.grants.join(", ")), Links.open(s.isProfile ? Links.profile(s.id) : Links.permSet(s.id))]
          })) : [{ cells: ["No object permission rows for this user.", "", ""] }]
        });
        const l6Host = document.getElementById("l6Paged");
        if (l6Host && layoutAssign) Shell.resultsTable(l6Host, {
          countLabel: layoutAssign.length + " layout assignments",
          columns: [{ h: "Layout", cls: "tname" }, { h: "Record type" }, { h: "", cls: "right" }],
          rows: layoutAssign.map((a) => ({
            cells: [Shell.esc(a.layout), Shell.esc(a.rt), Links.open(Links.layoutView(objectApi, a.layoutId))]
          }))
        });
        const flsHost = document.getElementById("flsPaged");
        if (flsHost) Shell.resultsTable(flsHost, {
          countLabel: fieldRows.length + " fields",
          columns: [{ h: "Field", cls: "tname" }, { h: "Read" }, { h: "Edit" }, { h: "Reason" }, { h: "Status" }, { h: "", cls: "right" }],
          rows: fieldRows.map((r) => ({
            selected: r.f.name === fieldName,
            cells: [Shell.esc(r.f.name),
              r.read ? '<span class="check">✓</span>' : '<span class="cross">✗</span>',
              r.edit ? '<span class="check">✓</span>' : '<span class="cross">✗</span>',
              Shell.esc(r.reason),
              r.edit ? Shell.badge("ALLOWED") : r.read ? Shell.badge("READ ONLY") : Shell.badge("DENIED"),
              Links.open(Links.field(objectApi, r.f.name))]
          }))
        });
      } catch (e) { out.innerHTML = Shell.error(e.message); }
    }

    if (params && params.user) pickUser(params.user);
  };

  Shell.register("permissions", mod);
})();
