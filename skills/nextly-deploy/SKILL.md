---
name: nextly-deploy
description: >-
  Use when deploying a Nextly project to production, on Vercel or a Node.js
  server: choosing the production database, creating and committing
  migrations, running them on deploy, the environment variables Nextly
  requires, media storage that survives restarts, and checking the live site.
  Also use when a deployed Nextly app has missing tables, refuses to start,
  or loses uploaded files.
metadata:
  nextly-version: 0.0.2-alpha.72
---

# Deploy a Nextly project

A Nextly app is a Next.js app, so it deploys wherever Next.js does. What
Nextly adds: a production database, migrations applied before the new code
serves traffic, a few environment variables, and media storage that is not
the local disk on serverless hosts.

Checked against `nextly` 0.0.2-alpha.67 with Next.js 16.4 and PostgreSQL 17:
the steps below were run end to end, from an empty database to a published
post in a production build. Run `npx nextly --version`; if it prints a newer
version, prefer <https://nextlyhq.com/docs/guides/deployment> where it
disagrees with this skill.

## 1. Pick the production database, and develop on the same kind

Use PostgreSQL (recommended) or MySQL in production; on Vercel, a managed one
such as Neon, Supabase or Vercel Postgres. SQLite does not survive on
serverless hosts.

Develop against the same kind of database, and switch **before** creating the
first migration. `migrate:create` writes SQL in the dialect of the database
configured when you run it, so migrations made on SQLite will not run on
PostgreSQL. If SQLite migrations already exist and nothing has been deployed,
delete `src/db/migrations/` (the `.sql` files and `meta/`) after switching and
run `migrate:create` again. A live SQLite installation needs its data moved,
which this skill does not cover.

To switch a project from SQLite to PostgreSQL:

Nextly's packages are released together, so install each `@nextlyhq/*`
package at exactly the version of `nextly` the project runs, which `npx nextly
--version` prints:

```bash
npm install "@nextlyhq/adapter-postgres@$(npx nextly --version)" pg   # pnpm add / yarn add / bun add
npm ls nextly @nextlyhq/adapter-postgres     # or pnpm ls / yarn why; both at the same version
```

Use the project's own package manager throughout, so its lockfile stays the
one that is deployed.

Then, in `.env`, set `DB_DIALECT=postgresql` and `DATABASE_URL` to a local
PostgreSQL database, and add `"@nextlyhq/adapter-postgres"` and `"pg"` to
`serverExternalPackages` in `next.config.ts`. Restart `next dev`.

## 2. Create the migrations and commit them

In development, schema changes apply directly. Production only applies
migration files. Whenever collections change, before deploying:

```bash
npx nextly migrate:create <what_changed>
```

It writes `src/db/migrations/<timestamp>_<name>.sql` and a snapshot in
`src/db/migrations/meta/`. Commit both. Migrations only move forward: to undo
one, add a new one.

## 3. Run migrations on every deploy

In `package.json`:

```json
{
  "scripts": {
    "build": "nextly migrate && next build"
  }
}
```

`nextly migrate` first creates or updates Nextly's own tables (users, roles,
media and the rest), then applies your pending migrations, against the
database in `DATABASE_URL`. On an empty database this is all that is needed
before the first start.

With several developers or preview deploys pointing at one database, run
`npx nextly migrate` as its own CI step before the deploy instead, and keep
`build` as `next build`.

## 4. Environment variables

| Variable                 | Value                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `DB_DIALECT`             | `postgresql` or `mysql`                                                                                     |
| `DATABASE_URL`           | the production database                                                                                     |
| `NEXTLY_SECRET`          | at least 32 characters, new for production: `openssl rand -base64 32`                                       |
| `NEXT_PUBLIC_APP_URL`    | the public URL, such as `https://example.com`                                                               |
| `NEXTLY_ALLOWED_ORIGINS` | only if browsers reach the app on an origin it does not see itself, such as behind a proxy; comma-separated |

`NEXT_PUBLIC_APP_URL` is built into the client bundle, so set it before the
build. Never commit `.env` files.

## 5. Media storage

Uploads go to `./public/uploads` by default. That is lost on every deploy or
cold start on Vercel and other serverless hosts. Use a storage adapter,
installed at the same version as `nextly` as above:

```ts
// nextly.config.ts, on Vercel: npm install @nextlyhq/storage-vercel-blob@<nextly version>
import { defineConfig } from "nextly/config";
import { vercelBlobStorage } from "@nextlyhq/storage-vercel-blob";

export default defineConfig({
  storage: [
    vercelBlobStorage({
      token: process.env.BLOB_READ_WRITE_TOKEN!,
      collections: { media: true },
    }),
  ],
  // collections, typescript, ...
});
```

Vercel sets `BLOB_READ_WRITE_TOKEN` when Blob storage is added to the project.
For AWS S3, use `@nextlyhq/storage-s3` with
`s3Storage({ bucket, region, accessKeyId, secretAccessKey, collections: { media: true } })`.
Other S3-compatible providers also need their `endpoint`, and a `publicUrl`
when files are served from another address. For Cloudflare R2:

```ts
s3Storage({
  bucket: process.env.R2_BUCKET!,
  region: "auto",
  accessKeyId: process.env.R2_ACCESS_KEY_ID!,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  publicUrl: process.env.R2_PUBLIC_URL,
  collections: { media: true },
});
```

For other providers, use the settings in the adapter's README. A Node.js
server with a persistent disk can keep the default.

On Vercel, uploads from the admin pass through a Vercel Function, which
refuses request bodies over 4.5 MB (`413 FUNCTION_PAYLOAD_TOO_LARGE`). With
this setup, files above that size cannot be uploaded through the admin; a
Node.js server has no such limit.

## 6. Plan how the first admin is created

A new production database has no admin. In production, `/admin/setup` does
not hand the site to whoever opens it first: it asks for a one-time setup
token. Pick one of these; both refuse once an admin exists.

- **The setup token, after deploying.** Either set your own token before the
  deploy, as `NEXTLY_SETUP_TOKEN` (at least 43 characters with at least 16
  distinct ones; `npx nextly setup-token --generate` prints one), or let
  Nextly generate one: the first production start prints a line beginning
  `[nextly] SETUP TOKEN` to the server's output (on Vercel, the runtime logs).
  Then open `/admin/setup` on the live site and enter it. A generated token
  lasts 24 hours and one setup; `npx nextly setup-token`, run with the
  production environment, replaces a lost one.
- **The CLI, before or after deploying.** With the production environment
  (`DATABASE_URL`, and every other variable the config reads):

  ```bash
  NEXTLY_ADMIN_PASSWORD='<your password>' \
    npx nextly users:create-admin --email admin@example.com --name "Site Admin"
  ```

  Without `NEXTLY_ADMIN_PASSWORD` it prompts for the password at a terminal. The password must be 8 to 128 characters with a lowercase letter, an uppercase letter, a number and a symbol.
  It needs no token, and it creates nothing if an account already uses that
  email.

Both need the release after 0.0.2-alpha.68. On an earlier version there is no
setup token: whoever opens `/admin/setup` first becomes Super Admin, so keep
the deployment private, behind your host's access protection, until you have
created the admin there.

Never run `next dev` against the production database. Development mode
applies schema changes directly to whatever database it points at.

## 7. Deploy

- **Vercel:** import the repository; Next.js is detected. Add the variables
  above for Production (and Preview, with its own database), then deploy.
  The `build` script migrates the database during the build.
- **Node.js server:** install from the lockfile (`npm ci`, `pnpm install
--frozen-lockfile`, `yarn install --immutable` on Yarn 2+, `yarn install --frozen-lockfile` on
  Yarn 1, or `bun install --frozen-lockfile`), run the `build` script, then `next start` under a
  process manager such as systemd, pm2 or Docker. Put a reverse proxy in
  front that terminates TLS and forwards `Host`, `X-Forwarded-Proto` and
  `X-Forwarded-For`.

### Behind a proxy, including Vercel

Nextly ignores `X-Forwarded-For` unless told to trust it, and then it cannot
tell clients apart: every sign-in, registration and password-reset request
shares one rate-limit bucket, 30 an hour by default, and everyone gets 429
after that. When every request reaches the app through a proxy that sets
`X-Forwarded-For` (Vercel does; configure nginx or Caddy to), trust it:

```ts
// nextly.config.ts
import { defineConfig } from "nextly/config";

export default defineConfig({
  security: { trustProxy: true },
  // collections, typescript, ...
});
```

When requests pass through more than one proxy, list the proxies' addresses
in `TRUSTED_PROXY_IPS` (comma-separated CIDRs), so the client is read from the
right hop. Do not turn this on for an app clients can reach directly: they
could then pick their own address.

## 8. Check the live site

- `npx nextly migrate:status`, run against the production `DATABASE_URL`,
  shows nothing pending.
- `/admin/setup` says setup is already complete, and `/admin` signs in with
  the admin created in step 6.
- Publish an entry and open a page that lists it: it appears.
- Upload an image in the admin, redeploy, and check it still loads.
- Do not use `/api/health` as an uptime probe on serverless hosts. It reports
  503 until Nextly has started in that same process, which a fresh instance
  that only receives probes never does. Probe a page that reads content
  instead.

## If something fails

- **Tables missing, or `relation "dc_..." does not exist`:** the migrations
  were not committed, or `nextly migrate` did not run against this database.
- **The admin and its API answer 500 in production:** check the server log.
  `NEXTLY_SECRET of at least 32 characters is required` means the secret is
  missing or too short, and `NEXT_PUBLIC_APP_URL is required` that the URL is
  not set.
- **Sign-in fails with `CSRF_FAILED` behind a proxy:** add the public origin
  to `NEXTLY_ALLOWED_ORIGINS`.
- **`next build` fails on a page reading content:** in an app with
  `cacheComponents: true`, wrap the read in `cachedFind` (the
  `nextly-collections` skill) or render it inside `<Suspense>`.
