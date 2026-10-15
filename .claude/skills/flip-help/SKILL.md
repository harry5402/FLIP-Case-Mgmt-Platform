---
name: flip-help
description: Show the FLIP commands the maintainer can use and what each one does. Use when the user asks what commands exist, how to get started, or what they can do here.
---

Show the user exactly this (you can adjust spacing, but keep the wording):

---

**FLIP commands** — type any of these in the message box:

| Command | What it does |
|---------|--------------|
| `/new-change` | Start a new change. Describe what you want (e.g. `/new-change add a "critical" flag to docket cases`) and Claude will look into it, show you a picture of what it affects, and explain a plan before touching anything. |
| `/show-me` | See a picture of how the platform fits together (`/show-me`), or what a change would affect (`/show-me adding a critical flag`, or `/show-me my change`). |
| `/go-live` | Make a finished change live on the website. Claude runs the checks, reviews its own work, tells you the risk, and asks before anything goes live. |
| `/something-broken` | Report a problem (e.g. `/something-broken the docket page won't load`). Claude investigates, tells you how serious it is, and what to do right now. |
| `/status` | See what's going on: any unfinished changes, what was last made live, and whether the site is up. |
| `/routine-care` | Walk through the weekly / monthly / yearly upkeep checklist together. |
| `/flip-help` | Show this list. |

**Good to know**
- Claude always explains its plan and waits for your OK before changing anything, and asks again before anything goes live.
- Every plan gets a risk rating: 🟢 Low, 🟡 Medium, or 🔴 High. For 🔴 High, Claude will recommend getting a technical person to look first.
- "Saved, not live" means the change is stored safely but the website hasn't changed yet.
- Making a change live logs everyone out of the app — pick a quiet moment.
- To stop Claude mid-task, press **Esc**.
- You can always just ask in plain English — the commands are shortcuts, not requirements.

---

Then ask: "What would you like to do?"
