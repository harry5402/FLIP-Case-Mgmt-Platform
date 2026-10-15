---
name: go-live
description: Make a finished, saved change live on the FLIP website — checks, automated code review, risk summary, explicit approval, deploy, and confirmation.
disable-model-invocation: true
---

The user wants to make a change live. Follow CLAUDE.md → "Shipping Changes" in full, using plain language and no git jargon. Steps:

1. **Find what's ready.** Check for saved changes not yet live (`git status`, `git branch --no-merged main`, uncommitted work). If there's nothing, say so plainly and stop. If there's more than one change, list them in plain words and ask which one — one change goes live at a time.
2. **Run the checks:** `npm test` and `node --check` on changed `.js` files. If anything fails, explain it in one or two sentences and stop — never ship failing tests.
3. **Confirm the docs are updated** in the same change (line map, tables, skill files, `docs/routine-care.md`, Recent Changes) per `skills/docs.md`. If not, update them first.
4. **Automated code review.** Invoke the `code-review` skill on this change (the draft compared with `main`). Then:
   - Fix real bugs it finds (tell the user what you fixed in one line each), re-run the tests, and review again if the fixes were significant.
   - If it finds something you can't confidently fix, or anything that raises the risk, stop and explain before going further.
   - Summarise the result for the user in plain words, e.g. "An automatic review found no problems" or "The review caught one issue — dates could show a day early — which I've fixed."
5. **Ask for the go-ahead.** Give a short summary of what will change on the live site, then say clearly: "**This will update the live site.**" Include:
   - The 🟢/🟡/🔴 risk rating and what could go wrong for staff
   - Any database change (applies to production automatically; a rollback won't undo it)
   - "Going live logs everyone out of the app" — suggest a quiet moment, early in the day; not late Friday or before a filing deadline
   - For 🔴 High: recommend a technical review again and require explicit confirmation ("Yes, I understand — go ahead")
   Then stop and wait for a clear yes.
6. **On a clear yes:** commit (stage files by name only — never `.env`, workbooks, `uploads/`, or `.claude/settings.local.json`), update `main`, merge the change, run `npm test` once more, then `git push origin main`. The push will show a permission prompt — tell the user to expect it and click Allow. Tests also run automatically before the push and will block it if they fail.
7. **Confirm it worked.** Wait about 3 minutes, check `curl -sI https://www.flipcasemgmt.com` returns `200`, then tell the user: it's live, staff will need to log back in, and ask them to glance at Railway → Deployments (newest says **Success**) and look at the changed page. Tidy up the finished draft.
8. **If anything looks wrong after going live**, switch to `skills/troubleshooting.md` — roll back first (Railway → Deployments → previous → Redeploy), fix second.
