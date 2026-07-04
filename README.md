# Orglens

**Read-only Salesforce analysis, inside your browser.**

Orglens is a Chrome extension that answers the questions Salesforce Setup makes hard: *what breaks if I change this field, why can this user see that record, what does this 74-element flow actually do?* It connects through the Salesforce session already open in your browser — no credentials, no installs in the org, no API keys — and reads metadata through the standard REST and Tooling APIs. Every answer is deterministic: the same org and the same question always produce the same result, because there is no AI and no heuristic anywhere in the analysis. Every claim on screen cites the source it was read from, and anything the browser session genuinely cannot read is labeled as a gap with a link to verify in Setup, never guessed. Results are built for two audiences at once: a plain-language Business view a stakeholder can read, and a Technical view with every API name, value, and reference. Documentation exports to Word in one click. Orglens never writes: the codebase contains no create, update, delete, deploy, or Apex-execution path of any kind.

## The six tools

| Tab | Question it answers |
|---|---|
| **Impact Analyzer** | If I change this component, what could break? Who depends on it, and what does it depend on? |
| **Permission Overlay** | Can this user do this? Evaluated in fixed order: L1 System → L2 Object CRUD → L3 Field Security → L4 Record Access → L5 Runtime → L6 Presentation. |
| **Flow Analyzer** | What does this flow do? Full documentation: reads/writes, every element in order, decision paths spelled out, subflows read from the called flow. |
| **Execution Explorer** | When a record is created/updated/deleted, what automation is eligible to run, in what order? |
| **Sharing Explorer** | Why does this user have access to this record? Effective access verified via `UserRecordAccess`, then each grant path checked — including real group-membership expansion. |
| **Configuration Explorer** | Where is this field/component configured or referenced — org-wide, in one table? |

## Feature highlights

- **Searches everything** — objects, fields, flows, validation rules, Apex classes and triggers, email templates, LWC, Aura, duplicate rules, matching rules, record types, page layouts, Lightning pages. Case-insensitive, no result cap, fully paginated.
- **Impact in both directions** with typed edges (Contains / Calls / Displays / Assigns / Filters by …), blast-radius counts, and per-type lists of reference surfaces the Dependency API does not index.
- **Permission evaluation with receipts** — every ✓/✗ names the profile or permission set that grants it, including Modify/View All Data; field security is a paginated table of every field with the reason; page-layout assignments per record type are read live.
- **Sharing that checks membership** — group share rows are expanded through `GroupMember`, nested groups, and role hierarchies to a definitive member / not-a-member answer; rows granting other users are collapsed out of the way.
- **Flow documentation for humans** — a numbered story in plain language ("If **High** — when Amount is more than 100000 → …"), or full technical detail, with a Word download of either.
- **Execution pipeline** with before/after-save flows, triggers per operation, validation, duplicate, assignment and workflow rules, approvals, scheduled paths read from each flow's metadata, and scheduled Apex jobs.
- Every reference includes an **Open ↗** link that lands on the exact Lightning Setup page.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked** and select the extension folder.
4. Log in to any Salesforce org (Lightning) in a tab, then click the Orglens icon.

Orglens connects to the org of the tab you launched it from; with multiple active sessions it picks deterministically.

## How it works

The background service worker discovers active Salesforce sessions from the browser's own `sid` cookies and issues **GET-only** requests to the REST, Tooling, and Search APIs (`v62.0`), following `nextRecordsUrl` until each query is exhausted. Metadata responses are cached per host for the session. Setup entities that reject `OR` filters or `queryMore` (e.g. `FlowDefinitionView`, `EntityDefinition`) are handled with per-branch query unions; Tooling entities whose `LIKE` is case-sensitive are fetched once and filtered client-side.

## Guarantees

- **Read-only by construction** — no write path exists in the code.
- **Deterministic** — no AI, no scoring, no inference presented as fact.
- **Evidence-first** — surfaces that are Metadata-API-only (record types, search layouts, Dynamic-Forms visibility, report types) or code-internal (dynamic SOQL, queueable chains, platform-event subscribers) are listed as explicit gaps with a Setup link.
- **No data leaves the browser** — Orglens talks only to your Salesforce instance.

## Known limitations

The Salesforce Dependency API indexes metadata references only: it cannot see standard-field references, free-text/hard-coded mentions, or logic inside Apex and LWC JavaScript bodies. Orglens states these limits inline rather than approximating them.

## License

MIT
