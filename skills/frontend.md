# Frontend Skill File — FLIP Matter Management

## Role
Handle UI, pages, client-side logic, and styling across the static frontend in `public/`.

**Who you're working with:** the maintainer may have little or no technical background. Describe changes by what staff will see and click. When verifying (see CLAUDE.md → Verification), screenshot the result so they can see it without needing to understand the code.

---

## Tools & Stack
- **No build step** — plain HTML, JS, CSS served statically from `public/`
- **No framework** — vanilla JS, no React/Vue/bundler
- **Styling:** `public/styles.css` — single global file shared by all pages (changes here affect every page)
- **API calls:** always use `authFetch()` from `auth.js` — never plain `fetch()`

---

## Architecture Patterns
- Each page = one `.html` file + one `.js` file (co-located in `public/`)
- Script order on every authenticated page: `auth.js` → `nav.js` → (`data.js` where used) → the page's own script
- `auth.js` provides `getUser()`, `isAdmin()`, `authFetch()`, `requireAuth()`, `requireAdmin()`, `escapeHtml()`
- `nav.js` injects the shared left sidebar into `<div id="app-nav">` — add or hide sidebar links there, not per page
- Permission-gated elements: add `id="..."` + `class="hidden"` in HTML, remove `hidden` in JS after checking role/permissions
- File downloads from API routes must use `authFetch()` + Blob URL — never a plain `<a href>` to an API route (will 401)

---

## Pages
| Page | What staff use it for |
|------|----------------------|
| `login.html` + `login.js` | Sign in |
| `index.html` + `dashboard.js` | Dashboard: My Tasks + Cases list |
| `weekly-tasklist.html` + `.js` | All open tasks grouped by day/overdue |
| `litigation-docket.html` + `.js` | Docket tabs, actions, collections, Money Back to Doe |
| `trademark-docket.html` + `.js` | Trademark docket: stage / portfolio / billing / to-do / client views |
| `case.html` + `case.js` | Individual case page |
| `new-case.html` + `.js` | Create a case |
| `defendant.html` + `.js` | Individual defendant page |
| `defendant-bookkeeping.html` + `.js` | Defendant bookkeeping entries |
| `group.html` + `group.js` | Group (multi-defendant) page |
| `bulk-upload.html` + `.js` | Bulk defendant upload |
| `listings-upload.html` + `.js` | Bulk listings upload |
| `automations.html` + `.js` | Threads & automations (e.g. Exhibit 2 generation) |
| `email.html` + `email.js` | Email portal — **hidden from the sidebar** but still used to connect/reconnect Microsoft accounts |
| `users.html` + `users.js` | Admin-only user management |
| `weekly-report.html` + `.js` | Weekly task completion reports |

Shared: `auth.js`, `nav.js`, `data.js` (case loading helpers), `styles.css`.

---

## Conventions
- Standard button style: `ghost-button` class
- Date strings from DB must be parsed as **local** calendar dates — use `new Date(year, month-1, day)` from a `YYYY-MM-DD` string; never `new Date(dateString)` directly (UTC parsing shifts date by one day)
- Always `escapeHtml()` before injecting any user-supplied string into the DOM
- `requireAuth()` at top of every page JS — redirects to login if no token; `requireAdmin()` for admin-only pages

---

## Docket Page Specifics
- Tabs (internal key → label): `NDIL ILND | GAND | NDIN INND | WDPA PAWD | EDWI WIED | WDTX TXWD | EDTX TXED | EDMO MOED | SDIL ILSD | UNFILED | Collections | Money Back to Doe | ARCHIVED`
- Adding a court: update every list named in the 2026-10-15 EDMO row of CLAUDE.md → Recent Changes (server tabs + DocketBird map, page tabs, both dropdowns, both label maps)
- Collections tab (`data-tab="COLLECTIONS"`): unified view of non-archived cases with ≥1 collections row; inline editable per card with per-card Save; "New Case" button hidden on this tab
- Docket cases sort by `cv-xxxxx` case number, not recent edit
- Per-case inline fields (e.g. Next Event) save on change — follow that pattern for new inline fields

---

## Risk by Area (use with CLAUDE.md's risk ratings)
| Change | Typical rating |
|--------|----------------|
| Wording, labels, colours, layout on one page | 🟢 Low |
| `styles.css` changes (affect every page) | 🟢 Low — check a few pages, not just one |
| New button/field that saves data (needs a backend route too) | 🟡 Medium |
| Showing/hiding things by role or permission | 🔴 High if it hides something from people who need it or shows admin tools to non-admins |
| Changing what a "Complete" / "Close" / "Delete" button does | 🔴 High |
| Date display or due-date logic | 🟡 Medium — dates shifting by a day is a classic bug here |

---

## Common Requests → Where to Look
| User asks for… | Usually touches |
|----------------|-----------------|
| "Change the wording / colour of X" | That page's `.html` / `.js`, or `styles.css` for site-wide styling |
| "Add / remove / rename a sidebar link" | `nav.js` |
| "Show X on the docket cards" | `litigation-docket.js` (card rendering) — and backend if the data isn't already returned |
| "Change the dashboard task list" | `dashboard.js` |
| "Change a trademark docket view" | `trademark-docket.js` (+ `routes/trademark.js` if new data) |

---

## What "Done" Looks Like
- Page works for both admin and non-admin roles
- Permission-gated elements correctly hidden/shown
- All API calls use `authFetch()`, including downloads
- Dates rendered correctly (local parse, not UTC)
- User-supplied strings escaped before DOM injection
- No console errors; verified in the test server with a screenshot shown to the user
