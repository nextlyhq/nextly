---
name: nextly-deploy
description: >-
  Use when deploying a Nextly project to production, on Vercel or a Node.js
  server: choosing the production database, creating and committing
  migrations, running them on deploy, the environment variables Nextly
  requires, media storage that survives restarts, and checking the live site.
  Also use when a deployed Nextly app has missing tables, refuses to start,
  or loses uploaded files.
---

# Deploy a Nextly project

A Nextly app is a Next.js app, so it deploys wherever Next.js does. What
Nextly adds: a production database, migrations applied before the new code
serves traffic, a few environment variables, and media storage that is not
the local disk on serverless hosts.

Checked against `nextly` 0.0.2-alpha.66 with Next.js 16.4 and PostgreSQL 17:
the steps below were run end to end, from an empty database to a published
post in a production build. Run `npx nextly --version`; if it prints a newer
version, prefer <https://nextlyhq.com/docs/guides/deployment> where it
disagrees with this skill.

## 1. Pick the production database, and develop on the same kind

Use PostgreSQL (recommended) or MySQL in production; on Vercel, a managed one
such as Neon, Supabase or Vercel Postgres. SQLite does not survive on
serverless hosts.

Develop against the same kind of database. `migrate:create` writes SQL in the
dialect of the database configured when you run it, so migrations made on
SQLite will not run on PostgreSQL. To switch a project from SQLite to
PostgreSQL:

Nextly's packages are released together, so install each `@nextlyhq/*`
package at exactly the version of `nextly` the project runs. `npx nextly
--version` prints it, for example `0.0.2-alpha.66`:

```bash
npm install @nextlyhq/adapter-postgres@0.0.2-alpha.66 pg
npm ls nextly @nextlyhq/adapter-postgres     # both must show the same version
```

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

## 6. Deploy

- **Vercel:** import the repository; Next.js is detected. Add the variables
  above for Production (and Preview, with its own database), then deploy.
  The `build` script migrates the database during the build.
- **Node.js server:** `npm ci`, `npm run build`, then `npm start` (`next
start`) under a process manager such as systemd, pm2 or Docker, behind a
  reverse proxy that terminates TLS and forwards `Host` and
  `X-Forwarded-Proto`.

## 7. Check the live site

- `npx nextly migrate:status`, run against the production `DATABASE_URL`,
  shows nothing pending.
- On a new database, open `/admin/setup` once and create the first admin;
  then `/admin` signs in.
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
