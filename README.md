# FLIP — IP Litigation Case Management Platform

A full-stack internal platform for managing IP (trademark/copyright) litigation caseloads end-to-end: docket tracking, defendant/case/group records, task assignment, weekly reporting, and third-party integrations — built to replace a spreadsheet-based workflow for a litigation team handling dozens of concurrent cases.

Server-rendered static frontend + a Node/Express API backed by Postgres, deployed on Railway with a Neon-hosted database.

## Features

- **Litigation docket tracking** — per-case docket entries and actions, tabbed by status/jurisdiction, with cascading task generation when actions are logged
- **Case, defendant & group management** — structured records for IP claims, defendants, multi-defendant groups, and negotiation/collection status
- **Task management** — personal and team task lists, due-date logic (internal vs. court deadlines), completion workflows, and recurring weekly cleanup
- **Weekly reporting** — automated CSV report generation summarizing task completion by user/week
- **MBFD (Money Back to Doe) tracking** — dedicated collections workflow separate from case status
- **DocketBird integration** — automated docket sync with graceful failure handling so sync issues never take down the app
- **Bookkeeping** — per-defendant financial entries (platform, amount restrained, notes)
- **Role-based auth** — session-based authentication with admin/user roles and per-user permission flags
- **Audit logging** — every significant mutation is recorded for accountability
- **Bulk data tools** — CSV bulk upload for listings/sellers, PDF exhibit generation, automations for repetitive litigation paperwork

## Tech Stack

- **Backend:** Node.js, Express, session-based auth
- **Database:** PostgreSQL (Neon), raw SQL with a lightweight query helper — no ORM
- **Frontend:** Static HTML/CSS/vanilla JS, page-per-view architecture
- **Integrations:** DocketBird API, Microsoft Graph (email), Anthropic API, Playwright (PDF/document generation)
- **Hosting:** Railway (app), Neon (Postgres)

## Architecture Notes

- All mutating writes that touch multiple tables go through an explicit transaction helper
- Due-date resolution always prefers an internal deadline over the court-facing one, never the reverse — a rule enforced everywhere dates are read
- `cases.status` (dashboard grouping) and a case's docket status are intentionally separate fields serving different purposes, to avoid conflating internal triage state with actual court status
- Frontend never calls `fetch()` directly — all API calls go through a shared authenticated client so session handling stays consistent across ~15 pages

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create `.env` (see `.env.example` for the full list of variables):
   ```
   DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DB?sslmode=require"
   DATABASE_SSL=true
   PORT=3000
   ```

3. Run `schema.sql` against your Postgres instance (Neon or local).

4. Start the server:
   ```bash
   npm run dev
   ```

   Open `http://localhost:3000`.

## Deploy (Railway)

1. Push this repo to GitHub.
2. Create a Railway project and connect the repo.
3. Add the environment variables from `.env.example` in Railway's dashboard.
4. Railway deploys automatically on every push to the connected branch.

## Notes

- `.env` is intentionally untracked — never commit real credentials.
- This repo's git history was scrubbed of a previously-committed `.env` and of test-data files that turned out to contain real case evidence rather than synthetic data.
