# Backend Skill File — FLIP Matter Management

## Role
Handle API routes, database access, auth, business logic, and scheduled jobs — mostly in `server.js`, plus the route modules in `routes/` and helpers in `lib/`.

**Who you're working with:** the maintainer may have little or no technical background. Follow CLAUDE.md's plan-first rule and risk ratings, and describe backend changes by their effect on people ("the docket will save a new 'critical' flag"), not by implementation ("adds a BOOLEAN column and a PUT route").

**Remember:** the local `.env` points at the **production** database — see CLAUDE.md before running anything that writes data.

---

## Tools & Stack
- **Language:** Node.js
- **Framework:** Express
- **DB client:** `pg` pool via `db.js` — always use the `query()` helper (or `withTransaction()`), never instantiate a pool directly
- **Database:** PostgreSQL (Neon)
- **Auth:** In-memory `sessions` Map (`server.js` ~line 206); Bearer token stored client-side in `localStorage` under `flipAuth`. **Every restart/deploy logs everyone out** — sessions don't survive.
- **Scheduler:** inside `start()` — `node-cron` Friday 9 AM ET overdue-task Teams DMs; `setInterval` weekly report Saturdays at noon (skips if that week already exists)
- **Hosting:** Railway (server), Neon (DB)

---

## Where Things Live
| File | Purpose |
|------|---------|
| `server.js` | Core: config, auth, migrations, litigation/docket, tasks, cases, defendants, groups, bookkeeping, weekly reports, `start()`. See CLAUDE.md's **server.js Line Map** (single source — keep it updated there, not here) |
| `db.js` | Postgres pool + `query()` / `withTransaction()` |
| `routes/trademark.js` | All `/api/trademark/*` routes + `/api/users/:id/trademark-access` |
| `routes/email.js` | Microsoft Graph email + Teams integration, email triage (uses Anthropic API), `notifyTaskAssigned` / `notifyOverdueSummary` |
| `routes/automations.js` | `/api/automations/*` — Playwright-driven jobs (e.g. Exhibit 2 PDF generation) |
| `lib/trademark.js` | Trademark constants + pure helpers (dates, matter numbers, status list) |
| `lib/trademark-schema.js` | `ensureTrademarkTables()` — trademark migrations |
| `lib/trademark-import.js` | Workbook → import-plan mapping (pure) |
| `scripts/import-trademark-workbook.js` | CLI importer — dry run by default; `--commit` writes to the DB (blocked for Claude) |
| `schema.sql` | Reference only — not auto-run; real migrations are the `ensure*` functions |
| `test/` | `node:test` suites — `npm test`, no DB needed |

---

## Architecture Patterns
- DB migrations run at startup inside `start()` — add new `ensure*` functions and call them there. They must be **additive and re-runnable** (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`). Starting the server applies them to production immediately.
- `app.use("/api", requireSession)` (~line 1384) gates all `/api/*` routes registered after it — never register protected routes before this line
- Route modules are registered near the end of `server.js` (~line 5220–5237), then the `/api` 404 catch-all
- Multi-step writes must use `withTransaction()`
- All significant mutations must write to `audit_logs` (`writeAuditLog`)
- DocketBird sync failures must NOT throw or crash the app — catch and log only

---

## Auth Middleware (apply in this order)
1. `requireSession` — validates Bearer token, sets `req.session`; 401 if missing
2. `requireAdmin` — checks `req.session.role === 'admin'`; 403 if not
3. `requireWeeklyReportAccess` — passes admins; checks `allow_weekly_report` from DB for others

---

## Database Tables
See CLAUDE.md's **Key Database Tables** for the full list (litigation, tasks, trademark, email). Rules that matter most:
- `cases.status` ≠ `litigation_case_state.docket_status` — completely separate fields, separate purposes
- Due dates: always use `internalDueDate`; fall back to `finalDueDate` only if null — never reverse this
- Docket tasks are rows in `tasks` with `task_type LIKE 'Docket:%'` and a `source_litigation_action_id` — sync via `syncLitigationTasks()`, do not manipulate directly
- Completing a docket task as owner → marks `litigation_actions` complete + cascades to collaborator tasks; as collaborator → marks only `litigation_action_collaborators` row
- Trademark items: closing an item with unbilled flags returns 409 `UNBILLED` unless `confirmUnbilled` is sent

---

## Side Effects to Watch For
These reach real people — flag them in the plan and never trigger them with test data:
- **Assigning a task or docket action to a user sends them a Teams DM** (`notifyTaskAssigned`, called from `server.js` ~2055, ~2944, ~2997)
- Teams messages are sent from the **first connected Microsoft account** (`getDefaultSendingAccount` in `routes/email.js`)
- `POST /api/email/send` sends real email; `/api/email/test-teams` sends a real Teams message
- DocketBird calls hit an external paid API
- Weekly report generation writes a permanent row per week

---

## Risk by Area (use with CLAUDE.md's risk ratings)
| Area | Typical rating |
|------|----------------|
| Read-only route returning existing data | 🟢 Low |
| New column / table (additive migration) + route that saves it | 🟡 Medium |
| Changing sorting, filtering, or calculations staff rely on (due dates, collections totals) | 🟡 Medium — 🔴 if due dates are involved |
| Anything in auth, sessions, passwords, `requireAdmin`, user permissions | 🔴 High |
| Changing or removing existing columns/data, or a migration that rewrites rows | 🔴 High |
| Task-completion cascade, `syncLitigationTasks`, trademark billing flags | 🔴 High |
| Email/Teams sending, DocketBird sync, the scheduler, automations | 🔴 High |
| `package.json` dependency changes | 🔴 High |

---

## Common Requests → Where to Look
| User asks for… | Usually touches |
|----------------|-----------------|
| "Add a field to docket cases" | `ensureLitigationTables` (new column on `litigation_case_state`), the `/api/litigation/cases` query, a PUT route like `updateNextEvent`'s, plus `public/litigation-docket.js` |
| "Add a field to cases / defendants" | Matching `ensure*Column` migration, `/api/cases` or defendant routes, `case.js` / `defendant.js` |
| "Change a trademark docket view or column" | `routes/trademark.js` (the `view=` handler), `lib/trademark.js`, `public/trademark-docket.js` |
| "Change who can see/do X" | `requireAdmin` / permission columns on `users` — 🔴 High |
| "Change the weekly report" | `generateWeeklyReport` in `server.js` |
| "Change the Friday reminder" | The `cron.schedule` block in `start()` + `notifyOverdueSummary` in `routes/email.js` — 🔴 High |
| "Something's broken" | Use `skills/troubleshooting.md` first |

---

## What "Done" Looks Like
- Route handles happy path and edge cases with correct status codes
- Input validated before hitting business logic
- Multi-step writes use `withTransaction()`; mutation written to `audit_logs`
- New routes added AFTER `app.use("/api", requireSession)`
- Migrations are additive and re-runnable
- `npm test` passes (add a test for new route logic where the existing suites make it easy)
- CLAUDE.md updated per `skills/docs.md` if endpoints, tables, or files changed
- The user has been told, in plain language, what changed and what (if anything) staff will notice
