---
name: show-me
description: Draw a picture of how the FLIP platform fits together, or of what a planned or saved change would affect. Use when the user asks to see, picture, or visualise the system or a change, and as part of every /new-change plan rundown.
argument-hint: blank for the whole platform, or describe a change (or "my change")
---

The user wants a picture. Request: **$ARGUMENTS**

## 1. Work out which picture
- **Nothing given** → **Overview**: the whole platform, nothing highlighted.
- **A described change** (e.g. "adding a critical flag") → **Change impact** for that idea. Investigate read-only to find which files/tables it would touch.
- **"my change" / "this change" / called from `/new-change`** → **Change impact** for the current plan, or for saved-but-not-live work (`git diff main...HEAD --stat` plus uncommitted changes). If there's more than one saved change, ask which.

## 2. Ground it in the system map
Read `docs/system-map.md`. Use **only** its boxes, labels, and connections — don't invent parts. For a change, map each touched file/table to its box:
- **Changes** (amber): boxes whose files or tables the change edits or adds to
- **Used, not changed** (teal): boxes the change relies on or writes through without altering (e.g. the activity log, an outside service it triggers)
- **Not affected** (gray): everything else

If a touched file isn't in the map, say so and treat that as a sign the map needs updating (offer to fix it — 🟢 Low).

## 3. Draw it
Use the visualization tool if one is available (e.g. `show_widget`); otherwise write a self-contained HTML file to Claude's scratchpad and open it in the user's browser.
- **Layout:** four columns, left to right — *What staff see* · *Server (Railway)* · *Database (Neon)* · *Outside services* — one box per map entry, using the map's labels.
- **Overview:** all boxes neutral; make each box clickable to ask "Explain the <label> part of FLIP in plain words".
- **Change impact:** colour boxes as above, draw arrows only between highlighted boxes (keep it uncluttered), and add a small legend: Changes / Used, not changed / Not affected.
- Keep text short, plain, and readable in light and dark mode.

## 4. Explain it underneath (plain language, 3–5 lines)
For a change impact, always include:
- **What changes**, in terms of what staff will see
- **Outside services:** "None touched" — or name them and what happens (e.g. "Assigning tasks will send Teams messages")
- **Everywhere effects**, if any: database setup change (applies to the live database), shared look/menus (shows on every page), going live logs everyone out
- The **🟢/🟡/🔴 risk rating** (same as the plan rundown)

Add one line: "This is a simplified picture — the plan and the automatic review check the details."

This command is read-only: never change code or data while drawing.
