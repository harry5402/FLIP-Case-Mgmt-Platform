# CLAUDE.md — FLIP Matter Management Router

## How to Use This File
Read this at the start of every session. It tells you what the project is, how to classify the task, which skill file to load, and where things live.

## FLIP Commands (for the maintainer)
Project slash commands live in `.claude/skills/`. If the user seems unsure how to start, suggest `/flip-help`.

| Command | Purpose |
|---------|---------|
| `/flip-help` | Lists these commands with plain-language descriptions (named `flip-help` because `/help` is built into Claude Code) |
| `/new-change` | Investigate → plan rundown with risk rating + impact picture → wait for approval |
| `/show-me` | Picture of the platform, or of what a change affects — drawn from `docs/system-map.md` |
| `/go-live` | Checks → automated code review → risk summary + approval → deploy → confirm |
| `/something-broken` | Troubleshooting flow (`skills/troubleshooting.md`) |
| `/status` | Read-only: unfinished changes, last thing made live, site up? |
| `/routine-care` | Walk through `docs/routine-care.md` |

Other project settings (`.claude/settings.json`): Plan mode by default, "Plain language" output style (`.claude/output-styles/`), permission locks, and a pre-push hook (`.claude/hooks/pre-push-tests.sh`) that runs `npm test` and blocks the push if tests fail. When adding or changing a command, update this table **and** `/flip-help`.

---

## Project Overview
- **Name:** FLIP Matter Management (repo/folder still named "FLIP Case Management")
- **Purpose:** Internal platform for managing IP matters — Schedule A litigation (cases, defendants, docket actions, tasks, weekly reporting) and the Trademark Docket (prosecution, maintenance, billing)
- **Stack:** Node/Express (`server.js`) + Postgres (Neon) + static HTML/JS/CSS (`public/`)
- **Hosting:** Railway (server), Neon (DB)

---

## ⚠️ The Local Database Is PRODUCTION
`DATABASE_URL` in `.env` points at the **live production Neon database**. The local test server, scripts, and any SQL you run all read and write real client and matter data. Treat every action as if it happens in production — because it does.

**Never remove real data. No exceptions, even if the user or a task seems to ask for it — stop and ask first.** The only exception is test records you created yourself (see "Test data" below). This includes:
- Deleting anything through the UI or API (cases, defendants, groups, tasks, docket actions, collections, trademark items/clients, users, files, bookkeeping entries)
- "Soft" removal that hides data: archiving, closing, hiding, soft-deleting, marking complete, removing a user, logging users out
- `DELETE`, `TRUNCATE`, `DROP`, or `UPDATE`s that blank out or overwrite existing values
- Migrations or code changes that drop/rename columns or tables, or rewrite existing rows
- Running `scripts/import-trademark-workbook.js --commit` (the default dry run is fine)

**When verifying in the browser:**
- Prefer read-only checks: load pages, open records, use filters/search, view modals without saving.
- Don't edit or save real records to test a form — use test data instead (below).
- Never trigger outward-facing actions: sending emails/Teams messages, DocketBird sync, generating weekly reports.

**Test data — allowed, with cleanup:**
You may create test records to try out a change, and delete them yourself afterwards. Staff can see test records on the live site while they exist, so keep it brief and tidy:
- **Mention it in the plan rundown** ("I'll create a test case to try this, then delete it").
- **Name everything clearly:** `TEST – <what it's for> – <date>` (e.g. `TEST – critical flag – 2026-10-15`).
- **Never assign test tasks or docket actions to a real person** — assigning sends that person a Teams message. Leave them unassigned (or use a free-text label like `TEST`).
- **Attach test data only to test records** — e.g. put test tasks/defendants under a test case, never under a real case. Completing a test task is fine if everything it touches is test data.
- **Keep a list** of every record you create (type + ID) as you go.
- **Delete only what's on your list**, one record at a time, through the app's normal delete buttons/API — never with SQL, and never by search/pattern (e.g. "delete everything named TEST"). Before each delete, confirm the record's ID and name match your list.
- **Clean up in the same session**, before reporting the work done, then tell the user what you created and removed. If anything couldn't be deleted, say so and list it.
- If you notice leftover `TEST` records you didn't create in this session, **don't delete them** — tell the user.

**Side effects of just starting the server:**
- `start()` runs all migrations against production. A new or changed migration in your working copy is applied to the live DB the moment you start the server — get user approval before starting the server with unreleased migration changes.
- The Friday 9 AM ET cron sends overdue-task Teams DMs to staff. A local server left running would send duplicates — always stop it when done.

---

## Explain the Plan Before Touching Code
Before editing, creating, or deleting **any** file, give the user a short plain-English rundown and **wait for their go-ahead.** No exceptions for "small" changes — keep the rundown brief for small changes, but always give one.

You may read code, search, and investigate first so the plan is accurate — just don't change anything yet.

The rundown should cover:
1. **What I understood you want** — one sentence, so a misunderstanding gets caught now.
2. **What will change** — described by what the user will see (pages, buttons, behaviour), not just file names.
3. **Risk rating: Low, Medium, or High** (see below) — with one sentence on *what could go wrong for the people using the site*, not technical detail. E.g. "If this goes wrong, the docket page might not load until it's rolled back."
4. **Questions or choices** — anything you'd otherwise have to guess.

End with a clear question, e.g. "Want me to go ahead, or change anything first?" Then stop and wait.

### Risk ratings
The user can't judge technical risk themselves — the rating is how you make it visible. Rate the **whole change by its riskiest part**, and when unsure between two levels, pick the higher one.

| Rating | What it covers | Examples |
|--------|----------------|----------|
| 🟢 **Low** | Looks and wording only; easy to undo; no data touched | Change a label or colour, reword a message, rearrange a page, add a read-only display of existing info |
| 🟡 **Medium** | New or changed behaviour that saves data, or adds to the database structure | A new field or toggle that saves (e.g. "critical" flag), a new filter or report, changing how a list sorts, adding a database column |
| 🔴 **High** | Could lock people out, lose or alter existing data, contact people outside the app, or is hard to undo | Logins, sessions, passwords, user permissions/admin access; changing or removing existing data or columns; email/Teams sending; DocketBird sync; the Friday scheduler; task-completion cascades; billing flags on trademark items; deleting features; upgrading packages |

**For High-risk changes:**
- Lead the rundown with the rating and a plain warning: "🔴 High risk — this touches *logins*. If it goes wrong, staff may be unable to sign in."
- **Recommend having a technical person review it before it goes live**, and say so explicitly. If the user wants to go ahead anyway, they must confirm after seeing the warning (e.g. "Yes, I understand — go ahead"). A plain "ok" or "sure" to the original plan isn't enough.
- Suggest a lower-risk alternative if one exists (e.g. a smaller first step, or a version that only adds and never changes existing data).

**Repeat the rating** at the go-live step (see Shipping Changes). If the change grew while you were working, re-rate it and tell the user before going further.

- **If you asked questions and the user says "go ahead" without answering them, do not start.** Don't pick defaults or guess. Politely repeat the unanswered questions and wait. Only start once every question has an answer (an answer like "your call" or "whatever's simplest" counts — then say what you chose).
- If the user changes the plan, give an updated rundown before starting.
- If you discover partway through that the work needs to go beyond what was agreed (more pages, a database change, a new risk), **stop and check in** before continuing.
- This is separate from the go-ahead to make a change live (see Shipping Changes) — both are always required.

---

## Verification
- Verify UI/frontend changes yourself in the test server before reporting them done — don't ask the user to check manually.
  - Start it with the `flip-server` config in `.claude/launch.json` (`node server.js` on port 3000), log in, and exercise the changed page/flow.
  - Check the browser console and server logs for errors; screenshot visual changes as proof.
  - Stop the server when you're done verifying (see the cron note below).
- Backend-only changes the browser can't exercise (scheduler, migrations, pure helpers) don't need a server run — rely on tests and static checks.
- Always run cheap static checks (`node --check`, existing test suites) when relevant.
- `npm test` runs the `node:test` suites in `test/` (no DB needed — route tests stub the database).

---

## Shipping Changes (Pushing Updates)
The person maintaining this may be new to git and deployment. **You handle all git mechanics** — they shouldn't need to type git commands or interpret git output. Explain each step in one plain sentence, no jargon.

**Key fact: pushing to `main` on GitHub = deploying to the live site.** Railway auto-deploys every push to `main` within a few minutes. There is no staging environment.

### Talking about branches
Use branches behind the scenes, but **don't make the user think about them.** Talk about "changes" instead:
- A branch = "a change" or "a draft", e.g. "your due-date fix". Don't say "branch", "checkout", "merge", "commit", or "push" unless the user uses those words first.
- "Saved, not live yet" = committed/pushed to a branch. "Live" = merged into `main` and deployed.
- Never ask the user to name, choose, or switch branches. Pick short descriptive names yourself (e.g. `fix-task-due-dates`).

### Starting a session
Run `git status` and `git branch` quietly. If there's unfinished work, describe it plainly and let the user decide: "You have an unfinished change from before — *the due-date fix* (saved, not live). Continue with it, or set it aside and start something new?"

### Starting a piece of work
1. `git checkout main && git pull` to get the latest code.
2. Create a branch for the change. Never make changes directly on `main`.
3. **If the user asks for something unrelated mid-change** (e.g. an urgent fix), commit the in-progress work to its branch, start a fresh branch from `main`, and tell them in one line: "I've set aside *the due-date fix* (saved, not live) — starting on the urgent fix now." Come back to the earlier change when they're ready.
4. Keep one change per branch so each can go live on its own.

### When the user says "push", "ship", "deploy", or "make it live"
1. **Check:** run `npm test` and `node --check` on changed `.js` files, and verify UI changes in the test server (see Verification). If anything fails, fix it or explain it — never ship failing tests.
   - **Update the docs in the same change** (follow `skills/docs.md`): if code was added, moved, or removed in `server.js`, re-check the **server.js Line Map** below against the real line numbers (`grep -n` the landmarks) and fix any range that's drifted more than ~50 lines. Also update the structure map, tables, endpoints, skill-file tables, and `docs/routine-care.md` if the change touched them, and add a **Recent Changes** row for new features. Docs go live with the code — never as a "later" task.
2. **Review what's going out:** run `git status` / `git diff` and give the user a short plain-English summary of what will change on the live site.
3. **Stage files by name** — never `git add -A` or `git add .`. Never commit `.env`, `.xlsx` workbooks, `import-report*.json`, `uploads/`, DocketBird files, `.claude/settings.local.json`, or `.claude/worktrees/` (the rest of `.claude/` is shared project config and *should* be committed when changed).
4. **Automated code review:** invoke the `code-review` skill on the change (draft vs `main`). Fix real bugs it finds and re-run the tests; if it finds something you can't confidently fix or that raises the risk, stop and explain. Tell the user the result in one plain sentence.
5. **Commit** with a short message in the existing style: `Area: what changed` (e.g. `Trademark docket: fix billing filter`).
6. **Push the branch** to GitHub (`git push -u origin <branch>`) — this does not deploy.
7. **Ask for an explicit go-ahead before going live.** Say clearly: "This will update the live site," and **restate the risk rating** (🟢/🟡/🔴, see Risk ratings) with what could go wrong. Call out specifically, in plain language:
   - A database migration (it runs against production automatically when the new version starts, and a rollback won't undo it)
   - Anything that changes or removes existing data
   - Changes to login, sessions, or user permissions
   - Changes to email/Teams sending, DocketBird sync, or the scheduler
   - For 🔴 High: repeat the recommendation to get a technical review, and require the same explicit confirmation as at the plan step.
   - **Going live logs everyone out** (logins are kept in server memory, and the server restarts on every deploy). Tell the user, and suggest a quiet moment for any change.
   - Suggest timing for 🟡/🔴 changes: go live early in the day when staff are around to notice problems — not late on a Friday or right before a filing deadline.
8. **On a clear yes:** `git checkout main && git pull`, `git merge <branch>`, run `npm test` again, then `git push origin main`. Delete the branch afterwards. Tell the user to expect a permission prompt for the push and to click Allow; the pre-push hook also re-runs the tests and blocks the push if they fail.
9. **Confirm the deploy:** wait ~3 minutes, then `curl -sI https://www.flipcasemgmt.com` should return `200`. Tell the user to glance at Railway → Deployments to confirm the newest one says Success, and to spot-check the changed page.

### If something goes wrong
- **Merge conflict:** resolve it yourself, explain in one sentence what overlapped, re-run tests before pushing.
- **Live site broken after a deploy — fastest fix:** walk the user through Railway → the service → Deployments → the previous successful deployment → **Redeploy**. This restores the old version in about a minute without touching git.
- **Then fix the code:** `git revert <commit>` (never delete history), test, and ship through the normal flow above. Note: a redeploy does NOT undo a migration that already ran — if a migration was involved, stop and explain the situation before doing anything else.
- **Never:** `git push --force`, `git reset --hard` on `main`, rewrite history, or push to `main` without the user's go-ahead.

---

## Task Classification — Read the Task, Pick a Lane

| If the task is about... | Load this skill file |
|-------------------------|----------------------|
| API routes, DB, auth middleware, migrations, business logic, scheduler | `skills/backend.md` |
| Pages in `public/`, UI, styling, client-side JS, `auth.js` usage | `skills/frontend.md` |
| Finding vulnerabilities, testing auth/access control, security review | `skills/pen-testing.md` |
| Load testing, performance, DB connection behavior under traffic | `skills/stress-testing.md` |
| Something broken, not working, or looks wrong | `skills/troubleshooting.md` |
| Updating this file after a structural change to the codebase | `skills/docs.md` |

**Spans two lanes?** Load both skill files. Most features touch backend + frontend together.

---

## Project Structure Map

```
/
├── server.js                        # Everything: all routes, migrations, business logic, scheduler (~5,350 lines)
├── db.js                            # Postgres pool + query() helper
├── lib/
│   ├── trademark.js                 # Trademark constants + pure helpers (dates, matter nos., suggestions)
│   ├── trademark-schema.js          # ensureTrademarkTables() — awaited in start()
│   └── trademark-import.js          # Pure workbook → import-plan mapping
├── scripts/
│   └── import-trademark-workbook.js # CLI importer (dry run by default; --commit). Never commit the .xlsx
├── test/                            # node:test suites (npm test)
├── schema.sql                       # Reference schema (not auto-run — migrations are in server.js)
├── package.json
├── .env                             # DATABASE_URL, DOCKETBIRD_API_TOKEN — never commit
├── public/
│   ├── auth.js                      # Shared auth client — loaded first on every page
│   ├── styles.css                   # Global styles — all pages share this
│   ├── index.html + dashboard.js    # Dashboard: My Tasks + Cases list
│   ├── weekly-tasklist.html + .js   # All open tasks grouped by day/overdue
│   ├── litigation-docket.html + .js # Docket tabs, actions, collections, MBFD
│   ├── trademark-docket.html + .js  # Trademark docket: stage/portfolio/billing/to-do/client views
│   ├── case.html + case.js          # Individual case page
│   ├── defendant.html + .js         # Individual defendant page
│   ├── group.html + group.js        # Group (multi-defendant) page
│   ├── users.html + users.js        # Admin-only user management
│   └── weekly-report.html + .js     # Weekly task completion reports
├── routes/                          # email.js, automations.js, trademark.js (/api/trademark/*)
├── .claude/                         # settings.json (Plan mode, locks, hook, output style), skills/ (FLIP commands), hooks/, output-styles/, launch.json
├── docs/
│   ├── routine-care.md              # Weekly/monthly/yearly upkeep checklist — walk the user through it when asked
│   └── system-map.md                # Plain-language map of pages → server → database → outside services; source for /show-me
├── data/                            # Supporting data files
├── uploads/                         # Uploaded files
└── skills/
    ├── backend.md
    ├── frontend.md
    ├── pen-testing.md
    ├── stress-testing.md
    ├── troubleshooting.md
    └── docs.md
```

---

## server.js Line Map
Approximate (±50 lines) as of 2026-10-15 — ~5,350 lines total. This is the single source; skill files point here.

| Lines | What's There |
|-------|-------------|
| 1–192 | Config, constants, helpers (`hashPassword`, `withTransaction`, etc.) |
| 193–349 | Static file serving, in-memory `sessions` Map (~206), CORS, `requireSession` / `requireAdmin` |
| 350–759 | DB migration functions (`ensureAuditLogTable`, `ensureLitigationTables`, etc.) |
| 760–971 | Business logic helpers (`syncLitigationTasks`, `generateWeeklyReport`, `ensureAdminUser`) |
| 972–1383 | Auth routes + user management |
| 1384 | `app.use("/api", requireSession)` — all protected routes registered after this |
| 1393–2750 | Litigation/docket routes (MBFD, cases, entries, actions, collections, archive, DocketBird) |
| 2753–3400 | Task routes (`/api/tasks/my`, `/api/tasks`, complete, state, general tasks, templates upload) |
| 3403–4870 | Cases, IP claims, defendants, groups, listings |
| 4873–4934 | Defendant bookkeeping-entries CRUD |
| 4935–5105 | Defendant negotiation, collection, bookkeeping (legacy) routes |
| 5108–5148 | Weekly report routes |
| 5149–5221 | Email integration tables |
| 5222–5237 | Route modules registered: `routes/email.js`, `routes/trademark.js`, automations router |
| 5238 | `/api` 404 catch-all |
| 5270–5356 | `start()` — runs all migrations (incl. `ensureTrademarkTables`), Friday cron, weekly report scheduler, `app.listen` |

-------|-------------|
| 1–175 | Config, constants, helpers (`hashPassword`, `withTransaction`, etc.) |
| 176–344 | Static file serving, session/CORS setup |
| 345–919 | DB migration functions (`ensureAuditLogTable`, `ensureLitigationTables`, etc.) |
| 919–1209 | Business logic helpers + auth routes + user management |
| 1250 | `app.use("/api", requireSession)` — all protected routes registered after this |
| 1211–2354 | Litigation/docket routes (MBFD, cases, entries, actions, collections, archive, DocketBird) |
| 2355–2951 | Task routes (`/api/tasks/my`, `/api/tasks`, complete, state, general tasks, templates upload) |
| 2952–4479 | Cases, IP claims, defendants, groups, listings, negotiations, defendant bookkeeping entries |
| 4480–4539 | Defendant bookkeeping-entries CRUD (`/api/defendants/:id/bookkeeping-entries`, `/api/bookkeeping-entries/:id`) |
| 4540–4765 | Defendant negotiation, collection, bookkeeping (legacy) routes |
| 4766–4802 | Weekly report routes |
| 4803–4919 | Email integration tables + automations router |
| ~5050 | Route modules registered: `routes/email.js`, `routes/trademark.js`, automations router, then the `/api` 404 catch-all |
| ~5100–5180 | `start()` — runs all migrations (incl. `ensureTrademarkTables`), cron jobs, `app.listen` |

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
| `trademark_clients` | Billing clients for TM work; `is_unresponsive`, `payment_risk`, `has_portfolio_view`, `aliases` |
| `trademark_matters` | One per firm matter no. (`matter_no_norm` unique); `application_status` (CHECK list in `lib/trademark.js`) |
| `trademark_docket_items` | One row per docket task; `stage` discriminator, `internal_due_date`/`response_due_date`, `work_state`, 5 billing flags, `is_closed`, `is_hidden`, `import_key` |
| `trademark_item_deadlines` / `trademark_todos` / `trademark_billing_questions` / `trademark_import_batches` | Extra dates per item; To Do & Sort; billing Q&A; importer runs |

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
| GET | `/api/trademark/items?view=` | Trademark docket list (due, stage, portfolio, ready_to_bill, unbilled_closed, review, closed) |
| PUT | `/api/trademark/items/:id/state` | Work state / close / soft-delete; 409 `UNBILLED` unless `confirmUnbilled` |

---

## Critical Rules (Non-Negotiable)
- The local DB is production — never remove, archive, hide, or overwrite real data; only test records you created this session may be deleted (see the production section at the top)
- Explain the plan and get a go-ahead before touching any file; get a second go-ahead before anything goes live
- Every change that adds features or moves code updates the line map and other CLAUDE.md/skill docs **before it goes live** (see `skills/docs.md`)
- `cases.status` ≠ `litigation_case_state.docket_status` — completely separate fields for separate purposes
- Due dates: always use `internalDueDate`; fall back to `finalDueDate` only if null — never reverse this
- All new protected routes must be registered AFTER `app.use("/api", requireSession)` at line ~1384
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
| 2026-10-07 | Trademark Docket added (lib/trademark*, routes/trademark.js, trademark-docket page, workbook importer, node:test suite). Design: TRADEMARK_DOCKET_DESIGN.md |
| 2026-10-15 | Handoff to a non-technical, AI-assisted maintainer: local DB flagged as production (no removing real data; self-cleaned test data allowed); plan-before-code rule with Low/Medium/High risk ratings; Claude verifies UI changes in the test server; plain-language Shipping Changes guide; `.claude/settings.json` adds Plan mode default + permission locks |
