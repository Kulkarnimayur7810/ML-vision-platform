# Private setup (example)

Copy this file to `private/setup.md` — that path is git-ignored. Never commit the real file, paste it in chat,
or screenshot it. Treat everything below as a secret except the placeholders.

## Accounts
- Owner email: `OWNER_EMAIL_HERE`
- Owner password: choose a strong one when `npm run create-owner` prompts for it. It is hashed (scrypt) in the
  database; it is never stored in source and there is no default.

## Vercel environment variables (mark all as Sensitive)
- `DATABASE_URL` = `PASTE_POOLER_STRING_HERE`          (Supabase "Transaction pooler", port 6543)
- `APP_SECRET` = `PASTE_64_HEX_HERE`                    (`openssl rand -hex 32`)
- `STORAGE_DRIVER` = `s3`
- `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` = `PASTE_HERE`

## One-off commands (run from a trusted computer, not from Vercel)
- `DATABASE_URL=<direct or session-pooler string> npm run migrate`
- `DATABASE_URL=<same> npm run create-owner`

## Worker machine (`worker/.env.worker`)
- `DATABASE_URL` = `PASTE_DIRECT_STRING_HERE`            (direct, port 5432 — not the transaction pooler)
- Same `S3_*` values as above.

## Where credentials live
- Supabase service-role key: **not used by this app**. Do not add it anywhere.
- Rotate: change `APP_SECRET` (invalidates file links), reset passwords from Team → member → Reset password.
