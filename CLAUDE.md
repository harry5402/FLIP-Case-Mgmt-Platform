# CLAUDE.md — FLIP Case Management Router

## How to Use This File
Read this at the start of every session. It tells you what the project is, how to classify the task, which skill file to load, and where things live.

---

## Project Overview
- **Name:** FLIP Case Management
- **Purpose:** Internal platform for managing IP litigation cases, defendants, docket actions, tasks, and weekly reporting
- **Stack:** Node/Express (`server.js`) + Postgres (Neon) + static HTML/JS/CSS (`public/`)
- **Hosting:** Railway (server), Neon (DB)

---

## Task Classification — Read the Task, Pick a Lane

| If the task is about... | Load this skill file |
|-------------------------|----------------------|
| API routes, DB, auth middleware, migrations, business logic, scheduler | `skills/backend.md` |
| Pages in `public/`, UI, styling, client-side JS, `auth.js` usage | `skills/frontend.md` |
| Finding vulnerabilities, testing auth/access control, security review | `skills/pen-testing.md` |
| Load testing, performance, DB connection behavior under traffic | `skills/stress-testing.md` |
| Updating this file after a structural change to the codebase | `skills/docs.md` |

**Spans two lanes?** Load both skill files. Most features touch backend + frontend together.

---

## Project Structure Map

```
/
├── server.js                        # Everything: all routes, migrations, business logic, scheduler (~4400 lines)
├── db.js                            # Postgres pool + query() helper
├── schema.sql                       # Reference schema (not auto-run — migrations are in server.js)
├── package.json
├── .env                             # DATABASE_URL, DOCKETBIRD_API_TOKEN — never commit
├── public/
│   ├── auth.js                      # Shared auth client — loaded first on every page
│   ├── styles.css                   # Global styles — all pages share this
│   ├── index.html + dashboard.js    # Dashboard: My Tasks + Cases list
│   ├── weekly-tasklist.html + .js   # All open tasks grouped by day/overdue
│   ├── litigation-docket.html + .js # Docket tabs, actions, collections, MBFD
│   ├── case.html + case.js          # Individual case page
│   ├── defendant.html + .js         # Individual defendant page
│   ├── group.html + group.js        # Group (multi-defendant) page
│   ├── users.html + users.js        # Admin-only user management
│   └── weekly-report.html + .js     # Weekly task completion reports
├── routes/                          # (if route files extracted from server.js)
├── data/                            # Supporting data files
├── uploads/                         # Uploaded files
└── skills/
    ├── backend.md
    ├── frontend.md
    ├── pen-testing.md
    ├── stress-testing.md
    └── docs.md
```

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
| 4920–4996 | `start()` — runs all migrations, cron jobs, `app.listen` |

---

## Key Database Tables
| Table | Notes |
|-------|-------|
| `users` | `role` ('admin'/'user'), `allow_weekly_task_cleanup`, `allow_weekly_report` |
| `cases` | `status` = dashboard grouping only (`Undelivered/Active/Fully Finished`), `is_docket_only` |
| `tasks` | FK to case/defendant/group; `task_type`; `status`; `completed_at TIMESTAMPTZ`; `task_role`; `source_litigation_action_id` |
| `litigation_case_state` | `docket_status` (NOT `cases.status`), `archived`, DocketBird link |
| `litigation_actions` | Docket entries; `assigned_to_user_id` OR `assigned_to_label` |
| `litigation_action_collaborators` | Per-collaborator completion state |
| `litigation_collections` | Collections rows per docket case |
| `mbfd_items` | Money Back to Doe — NOT a case |
| `audit_logs` | All significant mutations |
| `weekly_reports` | Generated CSVs, unique per `week_start` |
| `defendant_bookkeeping_entries` | Per-defendant modular bookkeeping rows (platform, amount_restrained, notes) |

---

## Active Endpoints (Key Ones)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Login — issues session token |
| GET | `/api/tasks/my` | Logged-in user's open tasks only |
| GET | `/api/tasks` | All open tasks (weekly tasklist) |
| POST | `/api/tasks/:id/complete` | Complete a task; triggers docket cascade if applicable |
| GET | `/api/litigation/cases` | Docket cases by tab/district |
| GET | `/api/litigation/collections-summary` | Unified collections view |
| POST | `/api/weekly-reports/generate` | Manually generate weekly report (admin) |

---

## Critical Rules (Non-Negotiable)
- `cases.status` ≠ `litigation_case_state.docket_status` — completely separate fields for separate purposes
- Due dates: always use `internalDueDate`; fall back to `finalDueDate` only if null — never reverse this
- All new protected routes must be registered AFTER `app.use("/api", requireSession)` at line ~1007
- All multi-step writes must use `withTransaction()`
- All significant mutations must write to `audit_logs`
- DocketBird sync failures must NOT crash the app — catch and log only
- Frontend API calls always use `authFetch()` — never plain `fetch()`
- Date strings from DB parsed as local calendar dates (`new Date(year, month-1, day)`) — never `new Date(dateString)` directly

---

## Do Not Commit
- `.env`
- DocketBird JSON/docs files

---

## Recent Changes
| Date | Change |
|------|--------|
| 2026-06-18 | Routing system initialized — skill files created, CLAUDE.md converted to router format |
