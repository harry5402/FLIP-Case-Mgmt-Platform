# Stress Testing Skill File — FLIP Case Management

## Role
Validate FLIP's performance under load — identify bottlenecks in the API, DB queries, and docket sync logic before they surface in production.

---

## Tools
- **Load generation:** k6 (preferred) or Artillery
- **Metrics:** k6 built-in dashboard; Railway metrics for CPU/memory; Neon query stats for slow queries
- **Target environment:** Local or staging — never production

---

## High-Risk Endpoints (Test These First)
| Endpoint | Method | Why It's Risky |
|----------|--------|----------------|
| `/api/tasks` | GET | Returns ALL open tasks — potentially large result set, no pagination |
| `/api/tasks/my` | GET | Per-user task fetch — hit under concurrent login |
| `/api/litigation/collections-summary` | GET | Unified view across all non-archived cases with collections rows |
| `/api/tasks/:id/complete` | POST | Triggers docket cascade (`syncLitigationTasks`) — multi-table write |
| `/api/weekly-reports/generate` | POST | Full report generation — CPU + DB heavy |
| `/api/litigation/cases` | GET | Full docket case list per tab |

---

## Load Profiles

### Baseline
- Concurrent users: 5
- Duration: 2 minutes
- Purpose: Confirm normal behavior under light load

### Soak Test
- Concurrent users: 20
- Duration: 20 minutes
- Purpose: Detect connection pool exhaustion or memory growth (in-memory session Map)

### Spike Test
- Ramp 5 → 50 users over 30 seconds
- Purpose: Simulate all staff logging in simultaneously at start of day

### Stress Test
- Increase load until p99 > 3s or error rate > 5%
- Purpose: Find the actual breaking point and which endpoint fails first

---

## Thresholds (Pass/Fail)
- p95 response time < 800ms
- p99 response time < 2000ms
- Error rate < 1%
- No connection pool errors from Neon during soak
- In-memory session Map size stable (not growing unboundedly) during soak

---

## Specific Concerns for FLIP
- **Single `server.js` file** — no horizontal scaling of individual services; bottleneck is process-wide
- **In-memory sessions** — Map grows with every login; confirm it's pruned on logout/expiry
- **`syncLitigationTasks()`** — called on docket task completion; verify it doesn't deadlock under concurrent completions
- **Neon connection pool** — serverless DB has cold-start latency; watch for pool timeout errors under spike

---

## What "Done" Looks Like
- All high-risk endpoints tested at each load profile
- Metrics captured and compared against thresholds
- Any pool errors, timeouts, or memory growth documented with evidence
- Bottlenecks identified at the query or code level, not just "it was slow"
