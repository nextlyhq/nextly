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
  nextly-version: 0.0.2-alpha.67
---

# Install Nextly into an existing Next.js app

Nextly runs inside the app: same server, same database, no separate service.
The project generator detects an existing Next.js app and installs Nextly into
it, including the build approvals, `esbuild` and the routes the admin needs.

Checked against `nextly` 0.0.2-alpha.67 with Next.js 16.4. Run
`npx nextly --version` after installing; if it prints a newer version, prefer
<https://nextlyhq.com/docs> where it disagrees with this skill.

## Before you start

- Next.js 15 or 16 with the App Router (`app/` or `src/app/`). On Next.js 14
  the generator leaves the Next config alone and prints the `experimental`
  block to add instead (`serverComponentsExternalPackages` and
  `instrumentationHook`).
- Node.js `^20.19.0 || ^22.12.0 || >=24.0.0`. Node 23 is not supported.
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

It installs with the app's own package manager. Inside a monorepo, it installs
with the workspace's package manager, from the workspace root. On pnpm it
approves the native build scripts Nextly needs (`better-sqlite3`, `esbuild`,
`sharp`) in `pnpm-workspace.yaml`, at the workspace root in a monorepo.

Develop on the database you will run in production. Migrations are written in
the dialect of the database you develop against (the `nextly-deploy` skill),
and SQLite is not suitable for serverless hosting.

What it changes. A file the app already has is kept as it is and reported as
skipped, with what Nextly needs in it; `.env` and `.env.example` get only the
keys they lack. Read its report, then review the rest in `git diff`:

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
safely, or Next.js 14), add what it prints. The list it needs holds `nextly`,
`@nextlyhq/adapter-drizzle`, `drizzle-orm`, `drizzle-kit`, `bcryptjs`,
`sharp`, `esbuild`, and your adapter and driver: `@nextlyhq/adapter-sqlite`
and `better-sqlite3`, `@nextlyhq/adapter-postgres` and `pg`, or
`@nextlyhq/adapter-mysql` and `mysql2`.

## 2. Start it and create the first admin

```bash
npm run dev
```

Open `http://localhost:3000/admin/setup` and create the first account; it gets
the Super Admin role. The first request creates Nextly's own tables. Then sign
in at `/admin`. Open the admin at the address in `NEXT_PUBLIC_APP_URL`
(`localhost`, not `127.0.0.1`): a form posted from another address is refused.

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
