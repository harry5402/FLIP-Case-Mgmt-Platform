# Trademark Docket — Design (Phase 3)

Inputs: Phase 1 workbook analysis, Phase 2 litigation docket analysis. Stack: Node/Express 4, `pg`, idempotent `ensure*` DDL awaited in `start()`, static HTML + vanilla JS. Client-specific tabs are referred to as **Portfolio-A** (agent tab with its own ref + due-date columns), **Portfolio-B** (foreign, multi-deadline `Action:` text), **Portfolio-C** (renewals, jurisdiction suffix on matter no.), **Portfolio-D** (referring firm, client-comment column). The importer identifies these by **header signature**, not name — no client names in code.

---

## 1. Reuse vs. differ

**Reuse directly**
- Route conventions: defensive body parsing, enum validation against module constants, 404 on missing row, `{error}` response shape, `writeAuditLog(req,{action,entityType,entityId,before,after})`, snake_case DB → camelCase JSON, `updated_by` text actor.
- Module pattern of `routes/email.js`: `registerTrademarkRoutes(app, deps)`, registered after `app.use("/api", requireSession)` and before the `/api` 404 catch-all.
- Litigation column semantics: `internal_due_date` + final/response date, effective due = `internal || response`, `is_hidden` soft-delete, `source`/`source_reference_id`-style unique key for idempotent upsert.
- Frontend: `fetchJson`-around-`authFetch`, `escapeHtml`, `parseDateValue` (data.js), `.docket-layout` / `.docket-sidebar` / `.tab-switch` shell, `.entries-table`, `.status-chip-*`, `.modal` / `.form-*`, stale-render token guard, `nav.js` link + icon.

**Must differ**

| Litigation | Trademark |
|---|---|
| Parent = `cases` (court case); case cards with action tables | Parent = **firm matter** (`3T`/`FT`/`CS` no.) with a billing client; UI is a **flat, deadline-sorted table** (~900 rows, mostly closed) |
| Tabs = jurisdictions | Tabs = **stage** + portfolio + billing/to-do/review views |
| `docket_status` per case | `application_status` per matter (12-value list) **+** `work_state` per item **+** billing flags per item — three separate concepts |
| No billing | 5-flag billing pipeline (Reported → Ready to Bill → Services → Expenses → Invoiced) with a "don't close before invoiced" guard |
| Enums only in JS | **CHECK constraints** + JS constants served via `/api/trademark/meta` |
| Bulk "save all entries", no transaction | Per-item create/update; every multi-step write in `withTransaction` |
| No try/catch (requests hang on DB error) | Local `asyncRoute` wrapper → JSON 500 |
| `isDueSoon` parses UTC | DATE columns selected as `YYYY-MM-DD` strings, parsed client-side as local dates |
| Collaborators, DocketBird, collections | Not needed in v1 |

## 2. One table vs. several — decision

**One `trademark_docket_items` table with a `stage` discriminator**, plus small side tables for things that aren't docket items (to-dos, billing questions, extra deadlines).

Why: ~90% of columns are shared across Applications, OAR, Post-Reg OA, SOU, Maintenance, Clearance, Contentious, Assignments and the portfolio tabs; the same matter moves through stages as separate rows (657 matters, 158 appear in ≥2 tabs); and the most valuable views are cross-stage ("everything due in 30 days", "ready to bill", "closed but not invoiced", "needs review") — with six tables every one is a six-way UNION. Portfolio rows are simply items whose stage comes from `Action:`.

Trade-offs: stage-specific fields are nullable (`client_ref`, `client_due_date`, `received_date`, `client_comment`; matter `title`/`proceeding_no` for contentious); per-stage required fields are enforced in JS, not the DB; rare one-off columns (fill colour, sticky notes, legacy hidden columns) go in `extra JSONB`, shown read-only. If one stage grows a very different lifecycle (e.g. full TTAB scheduling), add a 1:1 side table keyed by `item_id`.

## 3. Schema

All in `ensureTrademarkTables(query)` in `lib/trademark-schema.js`, awaited in `start()` right after `ensureLitigationTables()` (the importer calls it too). CHECK constraints added idempotently (drop-if-exists + add) so enums can grow. UUID PKs (`gen_random_uuid()`), `created_at`, `updated_at`, `updated_by` on every table.

**Clients: standalone `trademark_clients`, not linked to `cases`.** There is no clients table today (just `cases.client_name`); trademark billing clients are mostly agent/referring firms that never appear in litigation; contentious TM matters are TTAB/C&D, not federal cases. An optional `case_id` FK can be added later.

### `trademark_clients`
| column | type | source |
|---|---|---|
| name | TEXT NOT NULL | first-seen spelling of `Client` / portfolio tab name |
| normalized_name | TEXT NOT NULL UNIQUE | `normalizeClientName(name)` |
| aliases | TEXT[] | variant spellings merged in |
| kind | TEXT CHECK ('direct','agent_firm') | manual |
| has_portfolio_view | BOOLEAN | TRUE for the 4 portfolio tabs |
| is_unresponsive | BOOLEAN | Unresponsive Clients col A |
| payment_risk | BOOLEAN | Unresponsive Clients col B |
| contact_note, notes | TEXT | parenthetical contact |
| needs_review, review_reasons | BOOLEAN, TEXT[] | email-as-name, whitespace name, fuzzy alias |
| is_archived | BOOLEAN | |

### `trademark_matters`
| column | type | source |
|---|---|---|
| matter_no | TEXT | `Matter No.` / `FLIP Ref:` / `Ref. No.` |
| matter_no_norm | TEXT, unique where not null | `normalizeMatterNo()` |
| synthetic_key | TEXT UNIQUE | `NA:<client>:<brand>` for N/A / blank matter nos. |
| matter_family | TEXT CHECK ('3T','FT','CS','RCR','ST','OTHER') | prefix |
| parent_matter_no_norm | TEXT (not FK) | `3T#####.#` → `3T#####` |
| client_id | UUID FK trademark_clients | |
| client_ref | TEXT | `Client Ref. #` |
| jurisdiction | TEXT DEFAULT 'US' | `(UK)` suffix, `FT-`, country in brand |
| mark_text | TEXT | first `Brand` seen |
| nice_classes | SMALLINT[] | parsed from brand |
| title | TEXT | Contentious title / Assignment description |
| application_status | TEXT CHECK (12 values) | Applications `Status` |
| serial_no, registration_no, proceeding_no | TEXT | not in workbook (to be filled in app) |
| filing_date, registration_date, noa_date | DATE | new; anchors for deadline suggestions |
| notes, needs_review, review_reasons | | brand conflicts, malformed nos. |
| archived, archived_at, archived_by | | |

### `trademark_docket_items` (one workbook row = one item)
| column | type | source |
|---|---|---|
| matter_id | UUID NOT NULL FK | |
| stage | CHECK ('clearance','application','office_action','post_reg_oa','sou','maintenance','contentious','assignment','other') | tab, or `Action:` for portfolios |
| action_type | CHECK (office_action, post_reg_office_action, statement_of_use, extension_of_time, section_8_15, section_8_9_renewal, foreign_renewal, registration_fee, search_compact_plus, search_neo_lite, search_other, clearance_strategy, assignment, change_of_name, opposition, cancellation, cease_and_desist, suspension_check, legal_opinion, status_check, application_filing, other) | `classifyAction()` |
| action_label | TEXT | raw `Action:` text |
| brand | TEXT | row `Brand` |
| internal_due_date / internal_due_text | DATE / TEXT | `Internal Deadline` |
| response_due_date / response_due_text | DATE / TEXT | `Response Deadline` / trial-schedule column |
| client_due_date / client_due_text | DATE / TEXT | Portfolio-A due date (ranges kept as text) |
| received_date | DATE | Portfolio-A `Email Received:` |
| work_state | CHECK ('open','in_progress','awaiting_client','awaiting_signature','filed','reported','done','abandoned') | `deriveWorkState(comment, hidden)` |
| comment, client_comment, meeting_notes | TEXT | `Comment`, client comment, `Docket Meeting notes` |
| reported, ready_to_bill, services_entered, expenses_entered, invoiced | BOOLEAN | checkbox columns |
| invoiced_at | TIMESTAMPTZ | |
| cost_estimate | TEXT | Ready to bill tab |
| is_closed, closed_at, closed_by | | **hidden row = closed** |
| is_hidden | BOOLEAN | soft delete |
| assigned_to_user_id | UUID FK users | not in workbook; for later tasks phase |
| needs_review, review_reasons | | importer |
| source, source_tab, source_row | | informational, never a key |
| import_key | TEXT, unique where not null | §8 |
| import_batch_id | UUID FK | |
| extra | JSONB | fill colour, sticky notes, legacy cols |

Indexes: `(matter_id)`; `(stage)` and effective-due `COALESCE(internal, response)` partial on open/visible; `(ready_to_bill, invoiced)`.

### Side tables
- `trademark_item_deadlines` — extra dated deadlines per item (Portfolio-B use/renewal dates, TTAB schedule, grace ends): `item_id`, `label`, `due_date`, `source_text`, `is_done`, `is_hidden`, `needs_review`.
- `trademark_todos` — To do & Sort + Misc.: `kind` (todo/note), `due_date`/`due_text`, `received_date`, `action_item`, `email_subject`, `status` (open/in_progress/done), `status_note`, `assignee_initials`, `assigned_to_user_id`, `matter_id` (regex from subject), `is_hidden`, `import_key`.
- `trademark_billing_questions` — `matter_id`, `scope` (matter/all), `question`, `answer`, `is_resolved`, `import_key`.
- `trademark_import_batches` — `started_at`, `finished_at`, `source_basename`, `source_sha256`, `actor`, `summary JSONB` (no full paths stored).

**Application status enum** (the workbook list minus the billing value): Abandoned, Allowed, Dead/Cancelled, Not yet filed, Office Action Pending, Pending Renewal, Published for Opposition, Registered, Renewed, Statement of Use Accepted, Statement of Use Pending, Under Examination.

## 4. Status, deadline & billing model

- **Application status** lives on the matter, from the 12-value list only. "Reported and billed" is a billing state → import sets `reported=true, invoiced=true` on the item + review flag.
- **Work state** (per item) replaces what the workbook expressed via comment text, colour and hidden rows; edited explicitly in the app. Import derives it from comment regexes ("filed & reported" → reported, "awaiting instruction" → awaiting_client, "signature" → awaiting_signature, "abandon" → abandoned, "done/completed" → done; hidden row otherwise → done; else open).
- **Closed** (`is_closed`) replaces "hide the row". **Soft-delete** (`is_hidden`) is for mistakes only.
- **Billing** = five independent booleans. Derived chip: Invoiced > Ready to bill > Time/costs entered > none. **Guard:** closing an item with any billing flag set but `invoiced=false` returns 409 `UNBILLED` unless confirmed.
- **Deadlines:** effective due = `internal ?? response` (sorting + badges). Response date always shown with its own "Final ≤ 7 days" badge. Unparseable text kept verbatim in `*_due_text`. Due-soon offsets by stage (default 14 days; maintenance 60; SOU 30) — badges only, no new scheduler in v1.
- **Suggestions:** `suggestDeadlines(stage, anchors)` — OA = issue + 3 mo (+3 mo ext.); SOU = NOA + 6 mo, +6 per extension up to 36 mo; §8 = reg + 5–6 yrs (+6 mo grace); §8/9 = reg + 9–10 yrs (+grace); internal = response − 30 days. Shown as "Suggested — verify" chips in the edit modal; **Apply** only fills empty fields. Server never writes suggestions.

| Workbook tab | App representation |
|---|---|
| Ready to bill | **View**: `ready_to_bill AND NOT invoiced` |
| Outstanding Billing Questions | **Table** `trademark_billing_questions` + a view of closed items with billing flags but not invoiced |
| Unresponsive Clients | **Client flags** (`is_unresponsive`, `payment_risk`) shown as badges everywhere |
| To do & Sort, Misc. | **Table** `trademark_todos` |

## 5. Tasks integration

**Yes, but deferred** to a later phase once the docket is in use. It touches shared, litigation-critical task code (`/api/tasks/my`, `/api/tasks`, complete/state, weekly report, dashboard deep links), and the workbook has no assignee field so tasks would have no owner. v1 ships `assigned_to_user_id` so nothing needs migrating later. When built: `tasks.source_trademark_item_id` FK, `task_type = 'Trademark: …'`, sync by that FK only (never collides with litigation's `Docket:%` sync), plus litigation regression checks.

## 6. API (`/api/trademark`, all behind `requireSession`)

Permissions: any logged-in user (matches litigation) except client merge (admin). Audit actions `trademark.<entity>.<verb>`.

| Method | Path | Purpose |
|---|---|---|
| GET | /meta | enums, offsets, suggestion rules, portfolio clients |
| GET | /stats | sidebar counts |
| GET | /items?view=&stage=&clientId=&state=&q=&includeClosed=&needsReview= | list |
| GET | /items/:id, /items/:id/history | detail; audit history |
| POST | /items | create (may create matter/client in the same transaction) |
| PUT | /items/:id | field update |
| PUT | /items/:id/state | work state / close / reopen / soft-delete; UNBILLED 409 guard |
| PUT | /items/:id/billing | billing flags + cost estimate |
| PUT | /items/:id/review | clear needs_review |
| POST/PUT | /items/:id/deadlines, /deadlines/:id | extra deadlines |
| GET/POST/PUT | /matters, /matters/:id, /matters/:id/archive | matters |
| GET/POST/PUT | /clients, /clients/:id; POST /clients/:id/merge (admin) | clients |
| GET/POST/PUT | /todos, /billing-questions | to-dos; billing Q&A |

**No import endpoint** — import is CLI-only, so the workbook is never uploaded or stored.

## 7. UI

`public/trademark-docket.html` + `.js`, nav link after Litigation Docket, reuse the docket shell and CSS (adding `trademark-*` rules only).

- **Sidebar:** Work — Due (all open), Applications, Office Actions, Post-Reg OA, SOU, Maintenance, Clearance & Strategy, Contentious, Assignments, Other. Portfolios — one tab per portfolio client. Admin — To Do & Sort, Billing (Ready to bill / Closed-unbilled / Questions), Clients, Needs Review, Closed. Count badges from `/stats`.
- **Table:** Due (internal), Response, badges, Matter No., Client (+ unresponsive/payment-risk pills), Brand, Action, State (inline select), Comment (clamped), R/RB/S/E/I inline checkboxes, Meeting notes, Edit. Applications adds App Status; portfolios add Client Ref / Client Due / Client Comment; Contentious shows Title + Proceeding No.
- **Filters:** search (matter, brand, client, comment), client, work state, jurisdiction, matter family, include closed, needs review only. Persisted in URL.
- **Default sort:** effective due ascending (nulls last), then response due, then matter no.; click headers to re-sort.
- **Badges:** Overdue (red), Due soon (amber, per-stage offset), Final ≤ 7d (red), Grace period, Needs review, billing chip, "Closed, not invoiced".
- **Modal:** Matter / Deadlines (dates, raw text, suggestions) / Extra deadlines / Notes / Billing / Review reasons / History; Save, Close/Reopen, Delete (soft).
- Closed items only in the Closed tab or with "include closed"; archived matters hide their items from work views.

## 8. Import

`node scripts/import-trademark-workbook.js <path.xlsx> [--commit] [--aliases <json>] [--report <json>]` — **dry-run by default**; path from argv; `.gitignore` adds `*.xlsx` and `import-report*.json`; row mapping in a pure `lib/trademark-import.js` so it can be tested without a DB. Library: **`exceljs`** (exposes hidden rows/sheets, booleans for in-cell checkboxes, fills; SheetJS's npm build is stale with advisories).

Global rules: trimmed, case-insensitive tab/header matching; portfolio tabs by header signature; skip phantom rows (only booleans/blank/NBSP); text in a checkbox column → appended to comment + `column_shift` review; matter no. normalization (upper, trim, strip `(XX)` suffix into jurisdiction; validate format, else `malformed_matter_no`; N/A/blank → synthetic matter + `no_matter_no`); client normalization with optional aliases file, near-duplicates reported, never auto-merged; loose date parsing (real dates → local YYYY-MM-DD; `MM/DD-MM/DD` ranges → end date; "grace period" → flag; N/A/initials → text only; year outside 2000–2040 → review), raw text always preserved; hidden row → closed; fill colour stored in `extra` but not interpreted.

**Import key:** Portfolio-A uses its own ref; everything else `sha1(tab | matter | brand | action_type | first date | occurrence index)` — comment excluded so edits don't create duplicates. Re-runs skip existing keys; `--update` overwrites only rows never edited in the app (`updated_by = 'workbook-import'`). `--commit` runs in a single transaction and writes one `trademark.import` audit row. Output contains only counts and tab/row refs — no names.

Per-tab: Applications (hidden, still imported) → status onto matter; OAR / Post-Reg OA / SOU / Maintenance → standard template with stage-specific action classification; Clearance, Contentious (title, proceeding no., TTAB schedule left in comment + review), Assignments; portfolios via an `Action:` map; To do & Sort / Misc. → todos; Ready to bill → flags on the matching open item; Billing Questions → table; Unresponsive Clients → client flags; application status list validated against the constant (mismatch aborts).

## 9. Build plan (commits)

1. `test: add node:test harness`
2. `feat(trademark): pure domain helpers` + tests
3. `feat(trademark): schema`
4. `feat(trademark): workbook importer (dry-run)` + tests
5. `feat(trademark): importer commit/update modes`
6. `feat(trademark): API routes` + route tests (stubbed DB)
7. `feat(trademark): docket page` (HTML, JS, nav, CSS)
8. `feat(trademark): billing, to-do, clients, review views`
9. `docs: trademark docket` (CLAUDE.md incl. stale line map, skills)
10. *(later)* tasks cascade

The only litigation-adjacent `server.js` changes: one `await ensureTrademarkTables()` in `start()` and one route-register call.

## 10. Open questions (with default assumptions)

| # | Question | Default if unanswered |
|---|---|---|
| 1 | Add missing statuses (Filed/Pending, Suspended, §8 Accepted, Expired/Lapsed, Opposed)? | Keep the 12; use work state + comments |
| 2 | Is "Reported and billed" purely billing? | Yes → flags |
| 3 | Hidden Applications tab as master for application status? | Yes; flag disagreements with later-stage open items |
| 4 | Confirm statutory periods for suggestions | US OA, SOU, §8/§9 only, labelled "verify" |
| 5 | Who can close items / edit billing? | Any logged-in user; client merge admin-only |
| 6 | Client alias merges | Report only; merge via aliases file or admin merge |
| 7 | Is the workbook frozen after import? | Yes; app becomes source of truth |
| 8 | Import closed (hidden) history (~600 rows)? | Yes, as closed items |
| 9 | Parse TTAB schedules from comments? | No; manual + review flag |
| 10 | Assignees + tasks cascade | Deferred; column exists |
| 11 | Where to run the importer | Locally, dry-run first; never against prod without your go-ahead |
| 12 | Portfolio items also under stage tabs? | Yes; portfolio tabs are client filters |

---

## Implementation notes (2026-10-07)

Decisions made while building, relative to the design above:

- **Statuses:** the five extra application statuses (Filed/Pending, Suspended, Section 8 Accepted, Expired/Lapsed, Opposed) were approved and added.
- **Permissions:** any logged-in user can do everything, like the litigation docket. Client merge is the only admin-only action. Finer permissions are deferred.
- **Re-imports:** the workbook stays live for a few weeks, so there is no `--update` flag. Every `--commit` refreshes rows whose workbook content changed, but only if nobody has edited them in the app. The import key leaves out the deadline date, so changing a date in Excel updates the row instead of duplicating it. Rows edited in the app count as "app-edited" and are skipped.
- **Client aliases:** the importer also matches client aliases, so clients merged in the app stay merged on re-import.
- **Schema additions not in the design:**
  - `trademark_docket_items.trigger_date`: the OA issue date, used as the anchor for suggestions.
  - `trademark_docket_items.import_hash`: detects changed rows.
  - `trademark_item_deadlines.import_key`.
  - `trademark_billing_questions.matter_no_text`.
- **Left out of v1:**
  - Fill colour is not imported.
  - Tasks/My Tasks integration (§5) is deferred.
  - TTAB schedules are not parsed out of comments; they are flagged for review instead.
