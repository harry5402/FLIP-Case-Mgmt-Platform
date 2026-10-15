# Troubleshooting Skill File — FLIP Matter Management

## Role
Handle "something's broken / not working / looks wrong" reports. Find the cause, explain it in plain language, and recommend the safest fix — **investigate before changing anything.**

**Who you're working with:** the maintainer may have little or no technical background and may be stressed if staff are affected. Be calm and concrete: what's wrong, how serious it is, what to do right now.

---

## Step 1 — Is the live site down or broken for staff right now?
Ask (or check) first, because it changes the priority:
- `curl -sI https://www.flipcasemgmt.com` — a `200` means the server is up.
- Did a change go live in the last few hours? (`git log -5 --format='%h %ar %s' origin/main`)

**If the site is broken and a change went live recently → recommend rolling back first, investigate second.** Walk them through: Railway → the service → Deployments → the previous successful deployment → **Redeploy** (~1 minute). Note: a rollback does not undo a database migration that already ran — check for one before promising it fixes everything.

## Step 2 — Gather information (read-only)
- **Exact symptom:** which page, which button, what they expected, what happened, who's affected, since when.
- **Screenshot or error text** if they can share one.
- **Server logs:** you can't see Railway. Ask them to open Railway → the service → **Logs** (or Deployments → the latest → View logs), and copy the red/error lines around the time of the problem. Give them these exact steps.
- **Browser errors:** if it's one page, you can reproduce it in the test server and read the console.
- **Code:** read the relevant route/page — don't edit yet.

## Step 3 — Check the usual suspects
| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Everyone got logged out | A deploy/restart — sessions live in memory | Nothing to fix; just log back in. Explain this is expected after any change goes live |
| Site broke right after going live | The last change | Roll back (Step 1), then fix through the normal plan → approve flow |
| Teams reminders / assignment messages stopped | The connected Microsoft account's login expired, the account was deactivated (e.g. someone left), or `MS_CLIENT_SECRET` expired | Reconnect via `/email.html`; if that fails, check the secret expiry in Azure (see `docs/routine-care.md`) |
| Email triage / email page errors | Microsoft connection (above) or Anthropic API credits/key | Check Anthropic billing; reconnect Microsoft |
| DocketBird entries not updating | `DOCKETBIRD_API_TOKEN` expired/revoked, or DocketBird is down | Get a new token from DocketBird → update in Railway |
| A date shows one day off | A `new Date(dateString)` UTC-parsing bug | Code fix — use local date parsing (see `skills/frontend.md`) |
| "Payment failed" emails / services paused | Railway, Neon, or Anthropic billing | Update the card on that account |
| Trademark item won't close | 409 `UNBILLED` — unbilled flags are set | Working as designed; confirm billing, or close with the unbilled confirmation |

## Step 4 — Report and recommend
Tell the user, in this order:
1. **What's wrong** — one or two plain sentences.
2. **How serious** — who's affected, and is data at risk?
3. **What to do now** — e.g. "roll back", "reconnect the Microsoft account", "nothing — it's expected".
4. **The fix** — if code needs changing, give the normal plan rundown with a risk rating and wait for approval (CLAUDE.md rules apply in full, even when it's urgent).
5. **When to escalate** — recommend the backup technical contact (see `docs/routine-care.md` Key facts) if: data may be lost or wrong, the cause is in hosting/database infrastructure, a rollback didn't help, or you're not confident in the cause.

---

## Never, even under pressure
- Delete, "clean up", or bulk-edit real data to make a problem go away
- Run SQL against the database to patch records
- Skip the plan/approval steps because "it's urgent"
- Guess — if you're not sure of the cause, say so
