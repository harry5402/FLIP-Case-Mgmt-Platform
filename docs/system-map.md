# System Map — FLIP Matter Management

The source of truth for the `/show-me` picture. Each **box** is something a non-technical person can recognise; each lists the files and tables behind it so Claude can work out which boxes a change touches. Keep it current (see `skills/docs.md`) — if it's wrong, the picture is wrong.

Box IDs are used in the Connections section. Labels are what appears in the picture — keep them under ~18 characters.

---

## Column 1 — What staff see (pages in `public/`)

| ID | Label | Files |
|----|-------|-------|
| P-dash | Dashboard | `index.html`, `dashboard.js` |
| P-lit | Litigation docket | `litigation-docket.html`, `litigation-docket.js` |
| P-tm | Trademark docket | `trademark-docket.html`, `trademark-docket.js` |
| P-case | Case and defendant | `case.*`, `new-case.*`, `defendant.*`, `defendant-bookkeeping.*`, `group.*`, `bulk-upload.*`, `listings-upload.*` |
| P-tasks | Tasks and reports | `weekly-tasklist.*`, `weekly-report.*` |
| P-users | Users (admin) | `users.*`, `login.*` |
| P-email | Email and automations | `email.*` (hidden from sidebar), `automations.*` |
| P-shared | Shared look and menus | `styles.css`, `nav.js`, `auth.js`, `data.js` — **affects every page** |

## Column 2 — Server areas (Railway)

| ID | Label | Code |
|----|-------|------|
| S-auth | Login and users | `server.js` auth + user routes (~972–1383), `requireSession`/`requireAdmin`, in-memory `sessions` |
| S-lit | Docket area | `server.js` `/api/litigation/*` (~1393–2750), `syncLitigationTasks` |
| S-tm | Trademark area | `routes/trademark.js`, `lib/trademark*.js`, `scripts/import-trademark-workbook.js` |
| S-case | Cases area | `server.js` `/api/cases`, `/api/defendants`, `/api/groups`, listings, IP claims, bookkeeping, negotiation (~3403–5105) |
| S-tasks | Tasks and schedule | `server.js` `/api/tasks*` (~2753–3400), weekly reports (~5108–5148), `generateWeeklyReport`, Friday cron + Saturday scheduler in `start()` |
| S-email | Email and Teams | `routes/email.js`, `routes/automations.js`, email tables setup (~5149–5221) |
| S-migr | Database setup | All `ensure*` migration functions + `start()` — runs on every restart |

## Column 3 — Database (Neon)

| ID | Label | Tables |
|----|-------|--------|
| D-users | Users | `users` (logins themselves are in server memory, not the database) |
| D-lit | Docket records | `litigation_case_state`, `litigation_actions`, `litigation_action_collaborators`, `litigation_collections`, `mbfd_items` |
| D-tm | Trademark matters | `trademark_clients`, `trademark_matters`, `trademark_docket_items`, `trademark_item_deadlines`, `trademark_item_tasks`, `trademark_item_task_collaborators`, `trademark_todos`, `trademark_billing_questions`, `trademark_import_batches` |
| D-case | Cases, defendants | `cases`, `defendants`, `groups`, `ip_claims`, `listings`, `negotiations`, `group_negotiations`, `collections`, `bookkeeping`, `defendant_bookkeeping_entries`, `case_templates`, `docket_entries` |
| D-tasks | Tasks and reports | `tasks`, `weekly_reports` |
| D-email | Email links | `ms_connected_accounts`, `email_folder_mappings`, `email_thread_defendants`, `email_triage_queue` |
| D-audit | Activity log | `audit_logs` — written by most changes |

## Column 4 — Outside services

| ID | Label | Reached from |
|----|-------|--------------|
| X-teams | Microsoft Teams | `routes/email.js` (`sendTeamsDM`, `notifyTaskAssigned`, `notifyOverdueSummary`) |
| X-email | Microsoft email | `routes/email.js` (Graph API, `/api/email/send`) |
| X-db | DocketBird | `server.js` DocketBird helpers + `/api/litigation/cases/:id/docketbird-*` |
| X-ai | Anthropic AI | `routes/email.js` (email triage) |

---

## Connections (what talks to what)

Normal page → server → database flows:
- P-dash → S-tasks, S-case → D-tasks, D-case
- P-lit → S-lit → D-lit, D-tasks (docket actions create tasks via `syncLitigationTasks`)
- P-tm → S-tm → D-tm, D-tasks (trademark item tasks create tasks via `syncItemTaskMirrors` in `lib/trademark-tasks.js`)
- P-case → S-case → D-case
- P-tasks → S-tasks → D-tasks
- P-users → S-auth → D-users
- P-email → S-email → D-email
- P-shared → every page
- S-lit, S-case, S-tasks, S-tm, S-auth → D-audit (activity log)

Connections that reach **real people or paid services** — always call these out:
- S-tasks → X-teams: **assigning a task sends the person a Teams message**; Friday 9 AM ET overdue reminders
- S-lit → X-teams: **assigning a docket action sends a Teams message**
- S-tm → X-teams: **assigning a trademark item task sends a Teams message**
- S-email → X-email: sending email
- S-email → X-ai: email triage
- S-lit → X-db: DocketBird link / suggest / sync
- Teams messages are sent from the **first connected Microsoft account** (D-email `ms_connected_accounts`)

Things that affect everything:
- S-migr: database setup runs on every restart and applies to the **live** database
- Any change going live restarts the server → **everyone is logged out**
- P-shared: one change shows up on every page
