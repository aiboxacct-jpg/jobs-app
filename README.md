# Jobs App

Matt Myrtle's personal job pipeline, ported from the Muse "jobs" artifact
to a standalone Next.js app for **jobs.mattmyrtle.com**. Same screens and
behavior as the artifact — job cards with full descriptions, status /
source / work-mode / pay-type filters, pay sorting, attached application
documents, and the "📩 Send to Everest to apply" button — on new plumbing:
Next.js (App Router) on Vercel + Supabase Postgres, behind a one-time
magic-link sign-in.

## Architecture

- `app/page.js` — the job list UI (client component; redirects to `/login`
  when there is no session).
- `app/login/page.js` — email magic link via Supabase Auth
  (`signInWithOtp`, redirect to `/auth/callback`). Sessions are the
  supabase-js defaults: stored locally and auto-refreshed, so each device
  signs in once and then opens instantly.
- `app/api/actions/[action]/route.js` — the single server API implementing
  the artifact's action surface: `addJobs`, `updateJob`, `setStatus`,
  `listJobs`, `requestApply`, `listApplyRequests`, `ackApplyRequest`,
  `attachDocuments`, `attachPackageDocuments`, `setDocumentContent`,
  `removeDocument`. All `POST` with a JSON body; field names on the wire
  are camelCase exactly like the artifact.
- **API auth:** either `x-feed-key: <FEED_API_KEY>` (the cron feeds and
  the hourly apply watcher) or `Authorization: Bearer <Supabase access
  token>` (the signed-in UI). Anything else gets a 401. All data access
  uses the service-role key server-side only; the `jobs` table has RLS
  enabled with no public policies.
- `supabase/schema.sql` — the `jobs` table.
- `scripts/import-seed.mjs` — imports a Muse artifact export JSON
  (`.data.jobs`) into Supabase, upserting by `url` and never downgrading
  Applied/Saved rows.
- The app sends `X-Robots-Tag: noindex, nofollow` on every path
  (`next.config.js`) plus robots metadata — it stays out of search engines.

Behavior notes (matching the artifact):

- `addJobs` upserts by `url`; a re-sighted Applied/Saved job keeps its
  status, applied date, documents, and apply state.
- `setStatus` stamps `applied_date` with today's date in
  America/Los_Angeles when a job enters Applied (unless a date is given).
- `requestApply` is deduped — a second click changes nothing.

## Provisioning (one-time setup)

1. **Supabase:** create a project at supabase.com. In the SQL editor, run
   `supabase/schema.sql`. Under Authentication → URL configuration, add
   `https://jobs.mattmyrtle.com/auth/callback` (and the Vercel preview /
   production URLs you deploy to) as allowed redirect URLs.
2. **Env vars** (Vercel project settings; see `.env.example`):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_URL` (same URL), `SUPABASE_SERVICE_ROLE_KEY`,
   `FEED_API_KEY` (generate a long random string), `NEXT_PUBLIC_SITE_URL`
   (`https://jobs.mattmyrtle.com`).
3. **Vercel:** import this repo as a new project, attach the
   `jobs.mattmyrtle.com` domain, deploy.
4. **Seed data:**
   `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run import-seed -- <export.json>`
   and confirm the printed counts by status match the export.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in real values
npm run dev
```

## Pushing changes to GitHub

`push-jobs.py` pushes this directory to `aiboxacct-jpg/jobs-app` via the
GitHub git-data API (the connected token cannot create repos; the repo was
created by Matt). It skips `node_modules`, `.next`, `.git`, and env files:

```bash
python3 push-jobs.py "commit message"
```
