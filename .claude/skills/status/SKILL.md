---
name: status
description: Give a short plain-language status of the FLIP platform — unfinished changes, what was last made live, and whether the site is up. Read-only.
---

Give the user a quick status report. **Read-only — change nothing.**

Gather quietly:
1. `git fetch -q origin` then `git status -sb` — uncommitted work, and whether the local copy is behind the live code.
2. `git branch --no-merged main` — saved changes that aren't live yet. For each, read its last commit message to describe it in plain words.
3. `git log -3 --format='%ar — %s' origin/main` — the most recent changes that went live.
4. `curl -sI https://www.flipcasemgmt.com | head -1` — is the site up (`200`)?

Then report in plain language, no git terms, using this shape:

**Website:** ✅ Up (or ❌ Not responding — suggest `/something-broken`)
**Last made live:** *<plain description>* — <how long ago>
**Saved, not live yet:** *<plain description of each>* — or "Nothing waiting"
**Unsaved work in progress:** *<plain description>* — or "None"

If the local copy is behind the live code, say "Your copy is a little out of date — I'll update it before starting the next change." End with one suggested next step (e.g. "Use `/go-live` when you're ready to publish the due-date fix").
