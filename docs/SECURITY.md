# Security model

## Access
- **Every page, API route, file and model download requires a session.** There is no public area except the sign-in
  page, the invitation-redemption page and the endpoints they call.
- Sign-in is **email + password only**. No public registration, no email verification, no one-time codes, no
  confirmation links, no social login. The first owner is created by a server-side script
  (`npm run create-owner`); no password is hardcoded anywhere.
- Accounts are created by an owner/admin (temporary password shown once, change forced at first sign-in) or via a
  single-use invitation link (stored hashed, 7-day expiry). Password recovery is an admin reset from **Team**;
  members change their own password from the profile menu → **Change password**. None of this sends email.
- Passwords: scrypt with per-user salt, minimum length enforced, never logged or returned. Sessions: random
  256-bit token in an `httpOnly`, `SameSite=Lax` cookie (`Secure` in production); only a hash is stored. Sign-in
  locks an account out after 5 failed attempts in 15 minutes (per account, not per address).
- **Roles are enforced on the server** (`web/lib/authz.ts`), in API handlers and again in services: Owner, Admin,
  ML Engineer, Annotator, Project Member. Hiding a button is never the control.
- **Workspace isolation:** every query is scoped by workspace. A non-member gets `404` (not `403`) so ids and slugs
  can't be probed. Storage keys start with `w/<workspaceId>/…`, and downloads re-check the prefix.
- **Files:** served only through short-lived signed links (2–10 minutes) after a session + membership check;
  local-driver links are HMAC-signed with `APP_SECRET`, S3 links are presigned. Buckets stay private.
- Mutating requests from a browser must be same-origin. Responses are `no-store`; pages send
  `X-Robots-Tag: noindex`, `X-Frame-Options: DENY`, CSP (`frame-ancestors 'none'`), `nosniff`.
- Markdown documents are rendered without raw HTML and with unsafe URLs removed.
- **Secrets:** server-side only (never `NEXT_PUBLIC_*`); `.env*` and `web/private/*` are git-ignored; only
  placeholder examples are committed. The Supabase service-role key is not used at all.
- Database: row-level security is enabled on every table and public roles are revoked on each migration run.

## Verified by automated tests (all passing at the time of writing)
`web/tests/e2e/security.spec.ts` walks the real route tree and checks that **every** API route (all methods) answers
`401` anonymously, every page redirects anonymous visitors to `/login`, and every workspace route answers `404` to a
signed-in user of another team (all of these checks enumerate the code, so a newly added route is covered automatically). It also asserts there is no sign-up/OAuth/OTP route or UI, and that security headers
are present. `auth.spec.ts`, `team.spec.ts` and `training.spec.ts` cover login lockout, forced password change,
invitation single-use, cross-workspace id guessing, role limits, and tampered/expired file links.

## Not verified / known limits
- **Not tested on a live Vercel + Supabase deployment**; cookie `Secure` behaviour and headers behind Vercel's
  proxy still need the manual checklist in `DEPLOYMENT.md`.
- No two-factor authentication. No IP-level rate limiting beyond sign-in lockout (consider Vercel's firewall).
- CSP allows inline scripts/styles (a Next.js constraint without nonces).
- The **worker has full database and bucket access** by design; keep its machine and `.env.worker` private.
- Uploaded images are validated and re-inspected with `sharp`, but a hostile image is still untrusted input.
- Model files (`.pt`) are pickles: only load checkpoints your own team produced.
