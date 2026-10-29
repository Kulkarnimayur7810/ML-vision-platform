# Deploying to Vercel (+ Supabase + object storage)

> **Status: not verified on live accounts.** This guide was written and the app was tested locally (real Postgres,
> real browser, an S3-compatible emulator). It has **not** been deployed to Vercel, Supabase or a real bucket in
> this build. Follow it with the checklist in step 7 and treat anything that fails as a bug to report.

## What runs where

| Piece | Where | Why |
|---|---|---|
| Website + API (`web/`) | Vercel | Serverless, free Hobby tier is enough for a team of four |
| Postgres | Supabase (free tier) or any Postgres | Users, tasks, labels, jobs, results |
| Images, checkpoints, exports | S3-compatible bucket (Cloudflare R2, Supabase Storage S3, AWS S3) | Vercel's disk is not persistent |
| Training / evaluation | **Worker** on your PC or a GPU machine (`worker/`) | Vercel functions are short-lived and have no GPU |

Platform limits that shape the app: request bodies on Vercel are capped at ~4.5 MB (so browser uploads are
≤4 MB per request and the UI says so); functions are time-limited (hence the worker); the filesystem is
read-only/ephemeral (hence object storage). Free Supabase projects pause after a period of inactivity and have
small storage quotas — check current limits on their pricing pages before relying on them.

## 1. Database
1. Create a Supabase project (or any Postgres 14+). Pick a region near your users.
2. Collect two connection strings from the dashboard (Connect):
   - **Transaction pooler** (port 6543) → used by Vercel (`DATABASE_URL` in Vercel).
   - **Direct** or **Session pooler** (port 5432) → used for migrations and by the worker.
3. You do **not** need the Supabase `anon` or `service_role` keys. The app talks to Postgres only from the server.
   The migration `9999_lockdown.sql` enables row-level security on every table and revokes the public roles,
   so Supabase's auto-generated REST API cannot read your data even if its URL leaks.

## 2. Object storage
Create a **private** bucket and an access key pair limited to it.
- Cloudflare R2: endpoint `https://<account>.r2.cloudflarestorage.com`, region `auto`.
- Supabase Storage (S3 protocol): endpoint and region from Storage → S3 connection.
- AWS S3: leave `S3_ENDPOINT` empty, set `S3_REGION`, set `S3_FORCE_PATH_STYLE=0`.

No CORS rules are needed: the browser only ever follows short-lived signed links (images in `<img>`, downloads).

## 3. Create tables and the first owner (from your own computer)
```bash
cd web && npm ci
export DATABASE_URL='<direct or session-pooler string>'
npm run migrate
npm run create-owner        # prompts for email, name, password (hidden), workspace name
```
There is no sign-up page and no default account. The owner then creates the other three accounts from
**Team → Create account** (a one-time temporary password, forced change at first sign-in) or by invitation link.
No email is sent anywhere, so no email provider is needed.

## 4. Vercel project
1. Push the repository to GitHub (private).
2. Vercel → Add New → Project → import it. **Root Directory: `web`**. Framework: Next.js (auto-detected).
3. Settings → Environment Variables (mark each **Sensitive**; Production + Preview):

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | transaction pooler string |
   | `APP_SECRET` | `openssl rand -hex 32` |
   | `STORAGE_DRIVER` | `s3` |
   | `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | from step 2 |

   Never prefix any of these with `NEXT_PUBLIC_`. With `STORAGE_DRIVER=local` the server refuses to start on Vercel
   rather than silently losing files.
4. Deploy. In Settings → Functions, set the region next to your database.
5. Optional: add Vercel's Deployment Protection for preview URLs so previews aren't reachable by strangers.
   (Production is already login-only, independent of this.)

## 5. Worker
Follow [WORKER.md](WORKER.md) using the **direct/session** database string and the same `S3_*` values.

## 6. Day-to-day
- **Schema changes:** run `npm run migrate` from your computer *before* deploying code that needs it. Migrations are
  forward-only, ordered, transactional and guarded by a lock, so running twice is safe.
- **Backups:** the free Supabase tier may not include point-in-time backups. Take your own:
  `pg_dump "$DATABASE_URL" > backup.sql`, and keep the bucket versioned or periodically synced.
- **Rotate secrets:** changing `APP_SECRET` invalidates all file links (not sessions). To log everyone out,
  `delete from user_sessions;`. Reset a member's password from Team.
- **Cost:** the stack above fits free tiers for a small team; the worker is a computer you already own. Check
  current free-tier terms yourself — they change.

## 7. Verify the deployment (do all of these)
Replace `$URL` with the production URL.
```bash
# anonymous visitors get nothing
curl -s -o /dev/null -w "%{http_code}\n" $URL/api/auth/me             # expect 401
curl -s -o /dev/null -w "%{http_code}\n" $URL/api/w/anything/runs      # expect 401
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" $URL/w/anything   # expect 307 → /login
curl -s -I $URL/login | grep -i -E "x-robots-tag|content-security-policy|x-frame-options"
```
Then in a browser: sign in with the owner → sign out → paste a dataset URL (must go to the sign-in page) →
create a dataset → upload an image (≤4 MB) → label it → create a second account → confirm it only sees what its role allows →
start a worker → run a **Quick test** training → open the run → download the checkpoint → sign out and paste the
download link from the network tab after its 2-minute expiry (must fail).
The repository's automated suite (`web/tests/e2e/security.spec.ts`) can also be pointed at a deployment-like
build, but run the manual list above on the real URL before telling anyone it works.
