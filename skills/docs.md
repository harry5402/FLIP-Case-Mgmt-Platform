# Documentation Agent Skill File — FLIP Case Management

## Role
Keep `CLAUDE.md` accurate after any task that modifies the codebase. Run at the end of those tasks only — not independently. Update structure, not narrative.

---

## Trigger Conditions
Run after any task that:
- Adds, removes, or moves files in `public/` or `routes/`
- Adds new API endpoints or removes existing ones
- Adds a new `ensure*` migration function to `server.js`
- Introduces a new DB table or significantly alters an existing one
- Changes the line ranges in `server.js` significantly (new large blocks added)
- Adds or removes a major dependency in `package.json`

Do NOT run for:
- Bug fixes with no structural change
- Styling tweaks in `styles.css`
- Copy or label changes in HTML

---

## What to Update in `CLAUDE.md`

### Always check:
- **Key files table** — new `.html`/`.js` pairs in `public/`? New helper files?
- **server.js line map** — did new route blocks shift the line ranges?
- **Key database tables** — new table added by a migration? Column added that changes behavior?
- **Active endpoints table** — new routes added or old ones removed?

### Never touch:
- Task classification / routing table
- Skill file pointers
- Auth patterns section (stable by design)
- Critical rules section (change only if a rule actually changed)

---

## Process

1. Review what changed in the task (files touched, endpoints added, migrations written)
2. Check each relevant section of `CLAUDE.md` for staleness
3. Make the minimum edit — don't rewrite correct sections
4. If a new `ensure*` migration was added, update the line map ranges
5. Append a one-line entry to the **Recent Changes** table with today's date

---

## Conventions
- One-line descriptions in tables — no paragraphs
- If a file was renamed or moved, update the old entry rather than adding a duplicate
- If unsure whether something is significant enough to log, include it
- Never remove an entry unless the thing no longer exists

---

## What "Done" Looks Like
- `CLAUDE.md` reflects current files, endpoints, and table structure
- server.js line map is approximately accurate (±50 lines is fine)
- Recent Changes table has a new entry for this task
- The next Claude session can navigate FLIP without rediscovery
