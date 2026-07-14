# Backend Skill File — FLIP Case Management

## Role
Handle API routes, database access, auth, business logic, and scheduled jobs — all of which live in `server.js`.

---

## Tools & Stack
- **Language:** Node.js
- **Framework:** Express
- **DB client:** `pg` pool via `db.js` — always use the `query()` helper, never instantiate a pool directly
- **Database:** PostgreSQL (Neon)
- **Auth:** In-memory `sessions` Map; Bearer token stored client-side in `localStorage` under `flipAuth`
- **Scheduler:** `setInterval` inside `start()` — e.g. weekly report auto-generation Saturdays at noon
- **Hosting:** Railway (server), Neon (DB)

---

## Architecture Patterns
- All routes, migrations, and business logic live in `server.js` (~4400 lines, single file)
- DB migrations run at startup inside `start()` — add new `ensure*` functions there
- `app.use("/api", requireSession)` at line ~1007 gates ALL `/api/*` routes registered after it — never register protected routes before this line
- Multi-step writes must use `withTransaction()` helper
- All significant mutations must write to `audit_logs`
- DocketBird sync failures must NOT throw or crash the app — catch and log only

---

## Key Files
| File | Purpose |
|------|---------|
| `server.js` | Everything: routes, migrations, business logic, scheduler |
| `db.js` | Postgres pool + `query()` helper |
| `schema.sql` | Reference schema (not auto-run — migrations are in `server.js`) |
| `.env` | `DATABASE_URL`, `DOCKETBIRD_API_TOKEN`, session secret — never commit |

---

## server.js Line Map
| Lines | What's There |
|-------|-------------|
| 1–175 | Config, constants, helpers (`hashPassword`, `withTransaction`, etc.) |
| 176–344 | Static file serving, session/CORS setup |
| 345–919 | DB migration functions (`ensureAuditLogTable`, `ensureLitigationTables`, etc.) |
| 919–1209 | Business logic helpers + auth routes + user management |
| 1210 | `app.use("/api", requireSession)` — all protected routes registered after this |
| 1211–2354 | Litigation/docket routes (MBFD, cases, entries, actions, collections, archive, DocketBird) |
| 2355–2951 | Task routes (`/api/tasks/my`, `/api/tasks`, complete, state, general tasks, templates upload) |
| 2952–4479 | Cases, IP claims, defendants, groups, listings, negotiations, defendant bookkeeping entries |
| 4480–4539 | Defendant bookkeeping-entries CRUD (`/api/defendants/:id/bookkeeping-entries`, `/api/bookkeeping-entries/:id`) |
| 4540–4765 | Defendant negotiation, collection, bookkeeping (legacy) routes |
| 4766–4802 | Weekly report routes |
| 4803–4919 | Email integration tables + automations router |
| 4888 | `app.use("/api/automations", ...)` — automations router mount |
| 4891–4919 | Catch-all 404 + error handler |
| 4920–4996 | `start()` — runs all migrations, cron jobs, `app.listen` |

---

## Auth Middleware (apply in this order)
1. `requireSession` — validates Bearer token, sets `req.session`; 401 if missing
2. `requireAdmin` — checks `req.session.role === 'admin'`; 403 if not
3. `requireWeeklyReportAccess` — passes admins; checks `allow_weekly_report` from DB for others

---

## Key Database Tables
| Table | Notes |
|-------|-------|
| `users` | `role` ('admin'/'user'), `allow_weekly_task_cleanup`, `allow_weekly_report` |
| `cases` | `status` = dashboard grouping only (`Undelivered/Active/Fully Finished`), `is_docket_only` |
| `tasks` | FK to case/defendant/group; `task_type`; `status`; `completed_at TIMESTAMPTZ`; `task_role`; `source_litigation_action_id` |
| `litigation_case_state` | `docket_status` (NOT the same as `cases.status`), `archived`, DocketBird link |
| `litigation_actions` | Docket entries; `assigned_to_user_id` OR `assigned_to_label` |
| `litigation_action_collaborators` | Per-collaborator completion state |
| `litigation_collections` | Collections rows per docket case |
| `mbfd_items` | Money Back to Doe — NOT a case |
| `audit_logs` | All significant mutations |
| `weekly_reports` | Generated CSVs, unique per `week_start` |

---

## Critical Rules
- `cases.status` ≠ `litigation_case_state.docket_status` — completely separate fields, separate purposes
- Due dates: always use `internalDueDate`; fall back to `finalDueDate` only if null — never reverse this
- Docket tasks are rows in `tasks` with `task_type LIKE 'Docket:%'` and a `source_litigation_action_id` — sync via `syncLitigationTasks()`, do not manipulate directly
- Completing a docket task as owner → marks `litigation_actions` complete + cascades to collaborator tasks; as collaborator → marks only `litigation_action_collaborators` row

---

## What "Done" Looks Like
- Route handles happy path and edge cases with correct status codes
- Input validated before hitting business logic
- Multi-step writes use `withTransaction()`
- Mutation written to `audit_logs`
- New routes added AFTER `app.use("/api", requireSession)` line ~1007
- `CLAUDE.md` structure map updated if new endpoints or migrations were added
