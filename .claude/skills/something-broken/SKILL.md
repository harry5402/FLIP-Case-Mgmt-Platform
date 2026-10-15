---
name: something-broken
description: Investigate a problem with the FLIP platform — find the cause read-only, explain how serious it is, and recommend the safest fix. Use when the user reports something broken, not working, or looking wrong.
argument-hint: what's wrong
---

The user is reporting a problem: **$ARGUMENTS**

Follow `skills/troubleshooting.md` step by step. Key points:

- If no problem was described above, ask what's happening, on which page, and since when — then continue.
- **First, check whether the live site is down or a change just went live.** If the site is broken right after a change went live, recommend rolling back *before* investigating, and walk them through it.
- **Investigate read-only.** Don't change code or data while diagnosing. If you need server logs, give the user exact steps to copy them from Railway.
- **Report in this order:** what's wrong, how serious (who's affected, is data at risk), what to do right now, the fix (as a normal plan rundown with a risk rating, if code needs changing), and whether to call the backup technical contact.
- Stay calm and concrete — the user may be under pressure. Never skip the plan/approval steps because it's urgent, never delete or patch real data, and say so if you're not sure of the cause.
