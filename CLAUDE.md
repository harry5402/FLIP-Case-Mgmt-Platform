# FLIP Case Management — Developer Reference

## Stack
- **Backend**: Node/Express, `server.js` (~4400 lines, single file)
- **Database**: Postgres (Neon), accessed via `db.js` (`query()` helper wrapping pg pool)
- **Frontend**: Static HTML/JS/CSS in `public/`, no build step
- **Auth**: In-memory `sessions` Map on server; token stored in `localStorage` under `flipAuth`
- **Hosting**: Railway (server), Neon (DB)

## Key files

| File | Purpose |
|------|---------|
| `server.js` | All API routes, DB migrations, business logic, scheduler |
| `db.js` | Postgres pool + `query()` helper |
| `public/auth.js` | Shared client auth: `getUser()`, `isAdmin()`, `authFetch()`, `requireAuth()`, `requireAdmin()` |
| `public/styles.css` | Global styles — all pages share this one file |
| `public/index.html` + `dashboard.js` | Dashboard: My Tasks + Cases list |
| `public/weekly-tasklist.html` + `weekly-tasklist.js` | All open tasks grouped by day/overdue |
| `public/litigation-docket.html` + `litigation-docket.js` | Docket case tabs, actions, collections, MBFD |
| `public/users.html` + `users.js` | Admin-only user management |
| `public/weekly-report.html` + `weekly-report.js` | Weekly task completion reports |
| `public/case.html` + `case.js` | Individual case page |
| `public/defendant.html` + `defendant.js` | Individual defendant page |
| `public/group.html` + `group.js` | Group (multi-defendant) page |

## Server.js structure (by line range)

- **1–175**: Config, constants, helpers (`hashPassword`, `withTransaction`, etc.)
- **176–195**: Static file serving, session/CORS setup
- **196–310**: DB migration functions (`ensureAuditLogTable`, `ensureUserPermissionsColumns`, `ensureTaskCompletedAt`, `ensureWeeklyReportTable`, etc.)
- **311–560**: `ensureLitigationTables` (all docket-related schema migrations)
- **560–800**: Business logic helpers (`syncLitigationTasks`, `syncLitigationActionCollaborators`, `generateWeeklyReport`, `getWeekBounds`, `loadWeeklyCleanupPermission`)
- **800–1200**: Auth routes + user management routes
- **1200–2260**: Litigation/docket routes (MBFD, cases, entries, actions, collections, archive, DocketBird)
- **2260–2690**: Task routes (`/api/tasks/my`, `/api/tasks`, complete, state, general tasks)
- **2690–4380**: Case, IP claims, defendants, groups, listings, negotiations, bookkeeping
- **4380–4420**: Weekly report routes
- **4420–4470**: Error handler + `start()` init sequence + `app.listen`

## Auth patterns

**Server-side middleware** (in order of application):
1. `requireSession` — validates Bearer token, sets `req.session`; returns 401 if missing
2. `requireAdmin` — checks `req.session.role === 'admin'`; returns 403
3. `requireWeeklyReportAccess` — passes admins through; checks `allow_weekly_report` from DB for others
4. `app.use("/api", requireSession)` at line ~1007 — applies `requireSession` to all `/api/*` routes registered after it

**Client-side** (`auth.js`): `requireAuth()` redirects to login if no token; `requireAdmin()` additionally redirects non-admins to dashboard. `authFetch()` always sends `Authorization: Bearer <token>` — use it for ALL API calls (never plain `fetch`), especially for file downloads (plain `<a href>` to API routes will 401).

## Database tables (key ones)

| Table | Notes |
|-------|-------|
| `users` | `role` ('admin'/'user'), `allow_weekly_task_cleanup`, `allow_weekly_report` |
| `cases` | `status` = dashboard grouping only (`Undelivered/Active/Fully Finished`), `is_docket_only` |
| `tasks` | Links to case/defendant/group via FKs; `task_type` text; `status` ('Open'/'In Progress'/'Complete'); `completed_at TIMESTAMPTZ`; `task_role` ('owner'/'collaborator'); `source_litigation_action_id` |
| `litigation_case_state` | `docket_status` (NOT the same as `cases.status`), `archived`, DocketBird link |
| `litigation_actions` | Docket entries; `assigned_to_user_id` OR `assigned_to_label` ('Lead Counsel'/'Defendant'/'Unassigned') |
| `litigation_action_collaborators` | Per-collaborator completion state for docket actions |
| `litigation_collections` | Collections rows per docket case |
| `mbfd_items` | "Money Back to Doe" — NOT a case, separate table |
| `audit_logs` | Tracks all significant mutations |
| `weekly_reports` | Generated CSVs, unique per `week_start` |

## Task system rules

- **Dashboard My Tasks** (`/api/tasks/my`): only the logged-in user's open tasks
- **Weekly Tasklist** (`/api/tasks`): ALL open tasks, grouped into OVERDUE / Mon–Fri buckets
- **Due date**: always use `internalDueDate`; fall back to `finalDueDate` only if null — never reverse this
- **Docket tasks** are synced via `syncLitigationTasks()` — they are rows in `tasks` with `task_type LIKE 'Docket:%'` and a `source_litigation_action_id`
- **General tasks** have no `case_id`, `defendant_id`, or `group_id` — `targetType === 'general'`
- **Completing a docket task**: owner completion → marks `litigation_actions` complete + cascades to collaborator tasks; collaborator completion → marks only `litigation_action_collaborators` row
- **`allow_weekly_task_cleanup`**: per-user flag letting paralegals complete tasks not assigned to them
- Tasks move to OVERDUE bucket only after Sunday 11:59 PM; they stay in their day bucket all week

## Docket / Litigation rules

- Docket tabs: `NDIL | GAND | NDIN | MDFL | WDPA | EDWI | EDMO | UNFILED | Money Back to Doe | ARCHIVED`
- Docket cases sort by `cv-xxxxx` case number, not recent edit
- `cases.status` ≠ `litigation_case_state.docket_status` — these are completely separate fields for separate purposes
- Assignee options in docket: Unassigned (no label/user), Lead Counsel (`assigned_to_label='Lead Counsel'`), Defendant (`assigned_to_label='Defendant'`), or a real user (`assigned_to_user_id`)
- DocketBird sync: env var `DOCKETBIRD_API_TOKEN`; sync failures must NOT crash the app

## Weekly Reports

- Auto-generated every Saturday at noon (server local time) via `setInterval` in `start()`
- Covers tasks due Mon–Fri of the current week + any still-overdue tasks from prior weeks
- Admin can manually generate via `POST /api/weekly-reports/generate`
- Access gated by `users.allow_weekly_report`; admins always have access
- Download via `authFetch` + Blob URL — never a plain `<a href>` to the API

## Frontend patterns

- All pages load `auth.js` first (provides `escapeHtml`, `authFetch`, `getUser`, `isAdmin`, etc.)
- Date strings from DB must be parsed as **local** calendar dates, not UTC (e.g. `new Date(year, month-1, day)` from a `YYYY-MM-DD` string) — UTC parsing shifts the date by one day
- Nav links that are permission-gated use `id="..."` + `class="hidden"` in HTML, then JS removes `hidden` after checking role/permissions
- The `ghost-button` class is the standard button style throughout

## Do not commit
- `.env`
- DocketBird JSON/docs files
