---
name: nextly-install
description: >-
  Use when adding Nextly, the open-source CMS that runs inside a Next.js app,
  to an existing Next.js App Router project: installing its packages,
  creating nextly.config.ts, mounting the admin panel at /admin, choosing a
  database, and creating the first admin account. Also use when an existing
  Nextly install shows no collections, fails to load nextly.config.ts, or its
  admin panel misbehaves after setup.
metadata:
  nextly-version: 0.0.2-alpha.70
---

# Install Nextly into an existing Next.js app

Nextly runs inside the app: same server, same database, no separate service.
The project generator detects an existing Next.js app and installs Nextly into
it, including the build approvals, `esbuild` and the routes the admin needs.

Checked against `nextly` 0.0.2-alpha.67 with Next.js 16.4. Run
`npx nextly --version` after installing; if it prints a newer version, prefer
<https://nextlyhq.com/docs> where it disagrees with this skill.

## Before you start

- Next.js 16.4.1 or later, or 15.5.28 or later on the 15 line, with the App
  Router (`app/` or `src/app/`). Earlier versions carry the October 2026
  security advisories these releases fix.
- Node.js `^22.12.0 || >=24.0.0`. Node 20 and Node 23 are not supported.
- A clean git working tree, so every change below is visible in one diff.

## 1. Run the generator in the project root

```bash
npx create-nextly-app@alpha          # npm
pnpm dlx create-nextly-app@alpha     # pnpm
yarn dlx create-nextly-app@alpha     # yarn 2 and later
yarn create nextly-app               # yarn 1 (Classic): no tag; installs `latest`, the current release
bunx create-nextly-app@alpha         # bun
```

It finds `next` in `package.json`, asks "Install Nextly in this project?", then
asks which database and, for PostgreSQL or MySQL, its connection string. `-y`
skips the questions and uses SQLite at `./data/nextly.db`. `--database
postgresql` or `--database mysql` picks another; with `-y` as well, `.env` gets
a placeholder `DATABASE_URL` to replace before starting.

It installs with the app's own package manager (inside a monorepo, the
workspace's), adding the packages to the app's own `package.json`. On pnpm 10
and later it approves the native build scripts Nextly needs (`better-sqlite3`,
`esbuild`, `sharp`) in the setting that pnpm version reads: `pnpm-workspace.yaml`
from pnpm 10.6, `package.json` before it. In a monorepo the approvals go at the
workspace root.

Develop on the database you will run in production. Migrations are written in
the dialect of the database you develop against (the `nextly-deploy` skill),
and SQLite is not suitable for serverless hosting.

What it changes. It edits `package.json`, the Next config and pnpm's settings
in place, and adds to `.env` and `.env.example` only the keys they lack. A file
it would create that the app already has (`nextly.config.ts`,
`instrumentation.ts`, the admin's files and the routes) is kept as it is and
reported as skipped, with what Nextly needs in it. Read its report, then review
the rest in `git diff`:

| File                                           | What                                                                                                                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                                 | `nextly`, `@nextlyhq/admin`, `@nextlyhq/ui`, the database adapter and driver, `@tanstack/react-query`, `lucide-react`; `esbuild` as a dev dependency |
| `nextly.config.ts`                             | the config the CMS boots from, with empty `collections` and `singles`                                                                                |
| `next.config.ts`                               | Nextly, the adapter and the driver added to `serverExternalPackages`                                                                                 |
| `src/instrumentation.ts`                       | starts Nextly when the server starts                                                                                                                 |
| `src/app/admin/[[...params]]/`                 | the admin panel page and layout                                                                                                                      |
| `src/app/admin/api/[[...params]]/route.ts`     | the admin API                                                                                                                                        |
| `src/app/admin/api/media/[[...path]]/route.ts` | the admin's media route, where it uploads and edits media (signed-in only)                                                                           |
| `src/app/api/media/[[...path]]/route.ts`       | public, read-only media routes                                                                                                                       |
| `src/app/api/health/route.ts`                  | a health check                                                                                                                                       |
| `src/types/generated/`                         | where generated types go                                                                                                                             |
| `.env`, `.env.example`                         | `DB_DIALECT`, `DATABASE_URL`, `NEXTLY_SECRET`, `NEXT_PUBLIC_APP_URL`, for the keys missing                                                           |

Without a `src/` folder the same files go under `app/`, and `instrumentation.ts`
sits at the project root.

If it reports that it left the Next config alone (a config it cannot change
safely), add what it prints. The list it needs holds `nextly`,
`@nextlyhq/adapter-drizzle`, `drizzle-orm`, `drizzle-kit`, `bcryptjs`,
`sharp`, `esbuild`, and your adapter and driver: `@nextlyhq/adapter-sqlite`
and `better-sqlite3`, `@nextlyhq/adapter-postgres` and `pg`, or
`@nextlyhq/adapter-mysql` and `mysql2`.

## 2. Start it and create the first admin

```bash
npm run dev
```

Open `http://localhost:3000/admin/setup` and create the first account; it gets
the Super Admin role. Nextly creates its own tables when the server starts,
from `instrumentation.ts`; without that hook, on the first request. Then sign in
at `/admin`. Keep to one address for the admin: a form posted from an origin
other than the one serving the request is refused, unless that origin is listed
in `NEXTLY_ALLOWED_ORIGINS`.

## Check it worked

- `/admin` shows the dashboard after signing in.
- `npx nextly --version` prints the installed version.
- The dev server log has no `esbuild` error, and `/api/health` answers.

## Doing it by hand

If the generator cannot be used, the manual steps are at
<https://nextlyhq.com/docs/getting-started/installation> (option B). They
include the pnpm build approvals, `esbuild` and the admin's media route, which
the generator otherwise adds for you.

## Next

- Define content: the `nextly-collections` skill.
- Who can sign in and what they can do: the `nextly-authentication` skill.
- Going live: the `nextly-deploy` skill.
- Every docs page, for agents: <https://nextlyhq.com/llms.txt>.
