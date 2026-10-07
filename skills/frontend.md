# Frontend Skill File — FLIP Case Management

## Role
Handle UI, pages, client-side logic, and styling across the static frontend in `public/`.

---

## Tools & Stack
- **No build step** — plain HTML, JS, CSS served statically from `public/`
- **No framework** — vanilla JS, no React/Vue/bundler
- **Styling:** `public/styles.css` — single global file shared by all pages
- **Auth client:** `public/auth.js` — loaded first on every page
- **API calls:** always use `authFetch()` from `auth.js` — never plain `fetch()`

---

## Architecture Patterns
- Each page = one `.html` file + one `.js` file (co-located in `public/`)
- `auth.js` is always the first script loaded — provides `getUser()`, `isAdmin()`, `authFetch()`, `requireAuth()`, `requireAdmin()`, `escapeHtml()`
- Permission-gated nav links: add `id="..."` + `class="hidden"` in HTML, remove `hidden` in JS after checking role/permissions
- File downloads from API routes must use `authFetch()` + Blob URL — never a plain `<a href>` to an API route (will 401)

---

## Key Files
| File | Purpose |
|------|---------|
| `public/auth.js` | Shared auth: `getUser`, `isAdmin`, `authFetch`, `requireAuth`, `requireAdmin`, `escapeHtml` |
| `public/styles.css` | Global styles — all pages share this |
| `public/index.html` + `dashboard.js` | Dashboard: My Tasks + Cases list |
| `public/weekly-tasklist.html` + `weekly-tasklist.js` | All open tasks grouped by day/overdue |
| `public/litigation-docket.html` + `litigation-docket.js` | Docket tabs, actions, collections, MBFD |
| `public/case.html` + `case.js` | Individual case page |
| `public/defendant.html` + `defendant.js` | Individual defendant page |
| `public/group.html` + `group.js` | Group (multi-defendant) page |
| `public/users.html` + `users.js` | Admin-only user management |
| `public/weekly-report.html` + `weekly-report.js` | Weekly task completion reports |

---

## Conventions
- Standard button style: `ghost-button` class
- Date strings from DB must be parsed as **local** calendar dates — use `new Date(year, month-1, day)` from a `YYYY-MM-DD` string; never `new Date(dateString)` directly (UTC parsing shifts date by one day)
- Always `escapeHtml()` before injecting any user-supplied string into the DOM
- `requireAuth()` at top of every page JS — redirects to login if no token; `requireAdmin()` for admin-only pages

---

## Docket Page Specifics
- Tabs: `NDIL | GAND | NDIN | MDFL | WDPA | EDWI | EDMO | UNFILED | Collections | Money Back to Doe | ARCHIVED`
- Collections tab (`data-tab="COLLECTIONS"`): unified view of non-archived cases with ≥1 collections row; inline editable per card with per-card Save; "New Case" button hidden on this tab
- Docket cases sort by `cv-xxxxx` case number, not recent edit

---

## What "Done" Looks Like
- Page works for both admin and non-admin roles
- Permission-gated elements correctly hidden/shown
- All API calls use `authFetch()`, including downloads
- Dates rendered correctly (local parse, not UTC)
- User-supplied strings escaped before DOM injection
- No console errors
