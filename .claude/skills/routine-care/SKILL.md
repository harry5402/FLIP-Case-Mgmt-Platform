---
name: routine-care
description: Walk the user through the FLIP routine-care checklist (weekly, monthly, 6-monthly, or yearly) one item at a time.
argument-hint: weekly, monthly, 6-monthly, or yearly
---

Walk the user through `docs/routine-care.md`. Section requested: **$ARGUMENTS**

1. Read `docs/routine-care.md`. If no section was given above, ask which one: weekly, monthly, every 6 months, or yearly (suggest the one that seems most due).
2. **Do the checks you can do yourself** first and report the results (read-only):
   - Site up: `curl -sI https://www.flipcasemgmt.com | head -1`
   - Last deploy: `git log -1 --format='%ar — %s' origin/main`
   - Unfinished drafts: `git branch --no-merged main`
3. **Go through the remaining items one at a time.** For each: say what to check and give the exact clicks (which site, which menu), then wait for the user's answer before moving on. Keep each item to two or three sentences.
4. **If something needs fixing** (items marked 🔧, or a check that fails), don't fix it mid-checklist — note it, finish the walk-through, then offer to handle each one through the normal plan → approve flow.
5. **Finish with a summary:** what's all good, what needs attention, and anything to do before the next check. If the Key facts table has blanks or out-of-date entries the user just told you about, offer to update `docs/routine-care.md` (that's a 🟢 Low change, still with their OK).
