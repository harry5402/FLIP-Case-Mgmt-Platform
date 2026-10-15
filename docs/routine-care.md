# Routine Care Checklist — FLIP Matter Management

The platform mostly runs itself, but a few things need a human to check on them regularly. Most of this is just *looking* — opening a page and confirming something is green or paid. Anything that involves *changing* something is marked 🔧 and should go through Claude Code (or a technical person) as normal.

**Tip:** you can ask Claude Code "Walk me through the monthly routine care checklist" and it will go through this file with you step by step.

---

## Key facts (fill these in and keep them current)

| What | Where / who | Notes |
|------|-------------|-------|
| Live site | https://www.flipcasemgmt.com | |
| Code | GitHub — `FLIP-Case-Mgmt-Platform` | |
| Hosting (runs the app) | Railway | Deploys automatically when changes go live |
| Database | Neon | |
| Domain registrar (`flipcasemgmt.com`) | _fill in: company + account owner_ | |
| Domain renewal date | _fill in_ | |
| Microsoft app secret expiry date | _fill in_ (Azure portal → App registrations → the FLIP app → Certificates & secrets) | Email + Teams stop working when this expires |
| Teams/email sending account | _fill in: which mailbox_ | Must be a current staff or shared mailbox — see "When someone leaves" |
| Backup technical contact | _fill in: name, phone, email_ | Who to call when Claude can't fix it |
| Secrets stored in | _fill in: FLIP's password manager vault name_ | Never email secrets |

---

## Every week (5 minutes)

- [ ] **Site loads.** Open the live site and log in. Dashboard and Litigation Docket show data.
- [ ] **Friday reminders went out.** Overdue-task Teams messages are sent Fridays at 9 AM Eastern. Ask a colleague with an overdue task whether they got one. If nobody did, the Microsoft connection probably needs reconnecting (see "When something breaks").
- [ ] **Weekly report generated.** The report is created automatically on Saturdays at noon. Check the Weekly Report page shows last week.
- [ ] **No leftover test records.** Search cases/tasks for `TEST`. Claude should clean up its own test data — if any is left over, ask Claude to check whether it's safe to remove.

## Every month (15 minutes)

- [ ] **Railway: last deploy succeeded.** Railway → the project → Deployments. The newest one should say **Success**.
- [ ] **Railway: bill paid, usage normal.** Railway → Usage / Billing. No failed payments; cost roughly the same as last month.
- [ ] **Neon: bill paid, storage OK.** Neon → the project → Billing / Usage. No failed payments, not near any plan limit.
- [ ] **Anthropic: credits/billing OK.** The email triage feature uses Claude through FLIP's Anthropic account. Check console.anthropic.com → Billing has credit and no failed payments.
- [ ] **DocketBird sync working.** Open a docket case linked to DocketBird and confirm recent docket entries are appearing.
- [ ] **User list is current.** Users page: everyone listed still works at FLIP, and admin access is only given to people who need it. 🔧 Remove departed staff (admins can do this from the Users page).

## Every 6 months

- [ ] **Microsoft app secret expiry.** Check the date in the Key facts table. If it's within 2 months, 🔧 create a new secret in Azure and update `MS_CLIENT_SECRET` in Railway's variables (ask your technical contact if unsure). If it expires, email and Teams notifications stop.
- [ ] **Software package updates.** 🔧 Ask Claude Code: "Check whether any of our packages have security updates." Claude will rate these 🔴 High — have your technical contact review before anything goes live.
- [ ] **Test that a rollback works.** Railway → Deployments: confirm you can see the list of previous deployments and know where the **Redeploy** button is, so you're not finding it for the first time during an emergency.

## Every year

- [ ] **Domain renewal.** Confirm `flipcasemgmt.com` is set to auto-renew with a valid card, and the renewal date is in the Key facts table. If the domain lapses, the site goes offline.
- [ ] **Rotate secrets.** 🔧 Change the passwords/keys the app uses (database password, DocketBird token, Anthropic key, Microsoft secret, admin password) and update them in Railway. Ask your technical contact to do this or supervise it.
- [ ] **Review account owners.** Railway, Neon, GitHub, the domain, Anthropic and Azure should all be owned by FLIP accounts (not personal ones), with at least two FLIP people having access to each.
- [ ] **Update this checklist** if anything above has changed.

---

## When someone joins or leaves

**Joins:**
- Create their account from the Users page; only give admin access if they need it.

**Leaves:**
- Remove them from the Users page (reassign their open tasks first — the removal screen shows what they own).
- If they had access to Railway, Neon, GitHub, Azure or the password manager: remove them there too, and 🔧 **rotate any secrets they could see**.
- **Check the Teams/email sending account.** The app sends Teams messages from the *first connected Microsoft account*. If that's the person leaving, their mailbox will be shut off and all Teams notifications will stop. 🔧 Connect a shared FLIP mailbox via the Email page (`/email.html`) before their account is deactivated.

---

## When something breaks

| Symptom | First thing to try |
|---------|--------------------|
| Site won't load, or broke right after a change went live | Railway → Deployments → previous successful deployment → **Redeploy**. Takes ~1 minute. Then tell Claude what happened so it can fix the code. |
| Teams reminders / notifications stopped | The Microsoft connection likely expired. Open the Email page (`/email.html`) and reconnect the sending account. If that fails, check the Microsoft app secret expiry date. |
| DocketBird entries stopped updating | The DocketBird token may have expired or been revoked. 🔧 Get a new token from DocketBird and update `DOCKETBIRD_API_TOKEN` in Railway. |
| Railway or Neon says payment failed | Update the card on that account immediately — services may be paused. |
| Anything else, or the fixes above don't work | Ask Claude Code to investigate (it will explain before changing anything). If it's 🔴 High risk or Claude is stuck, call the backup technical contact. |
