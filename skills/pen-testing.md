# Pen Testing Skill File — FLIP Case Management

## Role
Find vulnerabilities in auth, access control, data exposure, and business logic across the FLIP platform.

---

## Scope
- **In scope:** All `/api/*` endpoints, auth flows, role/permission enforcement, docket and task logic, file handling
- **Out of scope:** Neon DB infrastructure, Railway hosting layer, DocketBird's own API
- **Environment:** Local or staging only — never test against production data

---

## Threat Model
- **Primary assets:** Case data, defendant PII, litigation documents, user credentials, audit logs
- **Likely attackers:** Authenticated non-admin users attempting privilege escalation; external actors targeting auth endpoints
- **High-risk areas:**
  - In-memory session store — no persistence, token lifecycle management
  - Role checks (`requireAdmin`) — any bypass exposes user management and all admin routes
  - `allow_weekly_task_cleanup` flag — paralegals completing tasks not assigned to them
  - Docket task completion cascade — owner vs. collaborator logic must not be crossable
  - `authFetch` enforcement — any page using plain `fetch` to an API route leaks a 401 attack surface

---

## Known Architecture Constraints to Test Around
- `app.use("/api", requireSession)` at line ~1007 — routes registered BEFORE this line are unprotected; check for any that shouldn't be
- Sessions stored in-memory Map — test for token replay, no-expiry issues, concurrent session behavior
- `audit_logs` — verify mutations that should be logged actually are
- DocketBird sync — verify failures are swallowed and don't expose stack traces in API responses

---

## OWASP Top 10 Checklist
- [ ] Broken Access Control — non-admin hitting admin routes; cross-user task/case access
- [ ] Cryptographic Failures — token entropy, password hashing (`hashPassword` helper)
- [ ] Injection — SQL injection via `query()` helper inputs; any raw string interpolation in queries
- [ ] Insecure Design — business logic flaws (e.g. completing another user's docket task as collaborator)
- [ ] Security Misconfiguration — unprotected routes, verbose error responses, CORS policy
- [ ] Vulnerable & Outdated Components — `npm audit` on `package.json`
- [ ] Authentication Failures — brute force on login, token invalidation on logout
- [ ] Software & Data Integrity Failures — audit log tampering, weekly report manipulation
- [ ] Security Logging & Monitoring Failures — mutations missing from `audit_logs`
- [ ] SSRF — DocketBird API token usage, any outbound fetch constructed from user input

---

## Finding Format
Document each finding as:
- **Endpoint:** method + path
- **Payload / steps:** exact reproduction
- **Observed:** what actually happened
- **Expected:** what should have happened
- **Severity:** Critical / High / Medium / Low / Informational

---

## What "Done" Looks Like
- All `/api/*` endpoints tested for auth enforcement
- Admin-only routes verified unreachable by non-admin tokens
- Cross-user data access attempts documented
- Findings written up with severity and reproduction steps
- Critical/High findings flagged immediately
