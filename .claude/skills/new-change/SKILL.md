---
name: new-change
description: Start a new change to the FLIP platform — investigate, then give a plain-language plan with a risk rating and wait for approval before touching any code.
disable-model-invocation: true
argument-hint: what you want changed
---

The user wants to start a new change: **$ARGUMENTS**

Follow CLAUDE.md in full — especially "Explain the Plan Before Touching Code", "Risk ratings", and "Shipping Changes → Talking about branches". Steps:

1. **If no change was described above**, ask in one sentence what they'd like changed, and stop.
2. **Check for unfinished work** quietly (`git status`, `git branch --no-merged main`). If there's an unfinished change, describe it in plain words ("*the due-date fix* — saved, not live") and ask whether to continue it or set it aside. Wait for the answer.
3. **Investigate read-only.** Load the matching skill files from the CLAUDE.md routing table (most changes need both `skills/backend.md` and `skills/frontend.md`) and use their "Common Requests" tables to find the right code. Do not edit anything.
4. **Give the plan rundown** — what I understood, what will change (in terms of what staff will see), the 🟢/🟡/🔴 risk rating with what could go wrong, any test data you'll create and delete, and your questions.
5. **Stop and wait.** End with "Want me to go ahead, or change anything first?" Do not start until every question is answered and the user approves. For 🔴 High, require the explicit confirmation described in CLAUDE.md.

Once approved: start a fresh draft from an up-to-date `main` (without mentioning branches), make the change, check it (tests, test server, screenshot), update the docs, clean up any test data, then report "saved, not live" and tell them to use `/go-live` when they're ready.
