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
  nextly-version: 0.0.2-alpha.66
---

# Install Nextly into an existing Next.js app

Nextly runs inside the app: same server, same database, no separate service.
The project generator detects an existing Next.js app and installs Nextly into
it. A few steps after it are needed on the current release; do all of them.

Checked against `nextly` 0.0.2-alpha.66 with Next.js 16.4. Run
`npx nextly --version` after installing; if it prints a newer version, prefer
<https://nextlyhq.com/docs> where it disagrees with this skill.

## Before you start

- Next.js 15 or 16 with the App Router (`app/` or `src/app/`). The generator
  writes `serverExternalPackages`, which Next.js 14 spells
  `experimental.serverComponentsExternalPackages`, so upgrade a Next.js 14 app
  first.
- Node.js `^20.19.0 || ^22.12.0 || >=24.0.0`. Node 23 is not supported.
- A clean git working tree, so every change below is visible in one diff.

## 1. On pnpm, allow the native builds first

Skip this on npm, yarn and bun. pnpm blocks dependency build scripts, and the
generator's own install then fails: pnpm 11 and later stop with
`ERR_PNPM_IGNORED_BUILDS` for `better-sqlite3` and `esbuild`, and pnpm 10
installs without building them, so `better-sqlite3` has no binding and the app
fails at boot. Allow them in `pnpm-workspace.yaml` before running the
generator (create the file with `packages: []` if the project has none):

```yaml
allowBuilds:
  better-sqlite3: true
  esbuild: true
  sharp: true
onlyBuiltDependencies:
  - better-sqlite3
  - esbuild
  - sharp
```

- pnpm 11 and later read `allowBuilds`; pnpm 10.6+ reads
  `onlyBuiltDependencies`. If the file already has an `allowBuilds` map, which
  a recent create-next-app writes with `sharp: false`, add the entries to that
  map (and set `sharp: true`) rather than adding a second `allowBuilds` key.
- pnpm 10.0 to 10.5 ignore both in this file: put the list in `package.json`
  instead, as `"pnpm": { "onlyBuiltDependencies": ["better-sqlite3", "esbuild", "sharp"] }`,
  or upgrade pnpm.
- If the generator already ran without this, add it now and run
  `pnpm install` again.

## 2. Run the generator in the project root

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

Develop on the database you will run in production. Migrations are written in
the dialect of the database you develop against (the `nextly-deploy` skill),
and SQLite is not suitable for serverless hosting.

What it changes. On this release the generator replaces `.env.example` and
writes `api/health/route.ts` without checking for files already there, so
review its changes in `git diff` and restore anything of yours from git:

| File                                       | What                                                                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `package.json`                             | `nextly`, `@nextlyhq/admin`, `@nextlyhq/ui`, the database adapter and driver, `@tanstack/react-query`, `lucide-react` |
| `nextly.config.ts`                         | the config the CMS boots from, with empty `collections` and `singles`                                                 |
| `next.config.ts`                           | `serverExternalPackages` for Nextly, the adapter and the driver                                                       |
| `src/app/admin/[[...params]]/`             | the admin panel page and layout                                                                                       |
| `src/app/admin/api/[[...params]]/route.ts` | the admin API                                                                                                         |
| `src/app/api/media/[[...path]]/route.ts`   | public, read-only media routes                                                                                        |
| `src/app/api/health/route.ts`              | a health check                                                                                                        |
| `src/types/generated/`                     | where generated types go                                                                                              |
| `.env`, `.env.example`                     | `DB_DIALECT`, `DATABASE_URL`, a generated `NEXTLY_SECRET`, `NEXT_PUBLIC_APP_URL`                                      |

Without a `src/` folder the same files go under `app/`.

Check the two files it may have left alone:

- **`next.config.ts`:** if it already had a `serverExternalPackages` list, the
  generator does not touch it. Make sure the list includes `nextly`,
  `@nextlyhq/adapter-drizzle`, `drizzle-orm`, `drizzle-kit`, `bcryptjs`,
  `sharp`, `esbuild`, and your adapter and driver:
  `@nextlyhq/adapter-sqlite` and `better-sqlite3`,
  `@nextlyhq/adapter-postgres` and `pg`, or `@nextlyhq/adapter-mysql` and
  `mysql2`.
- **`.env`:** if it already had a `DATABASE_URL`, the generator adds nothing to
  it. Add any of `DB_DIALECT`, `NEXTLY_SECRET` and `NEXT_PUBLIC_APP_URL` that
  are missing, using `.env.example` as the guide. Generate a new secret with
  `openssl rand -base64 32` rather than copying the one in `.env.example`.

**Before the first commit, take the secret out of `.env.example`.** The
generator writes the same generated `NEXTLY_SECRET` into `.env` and into
`.env.example`, and `.env.example` is the file projects commit. Replace its
value with a placeholder such as `NEXTLY_SECRET=replace-with-openssl-rand-base64-32`.
If that file was already committed or pushed with the real value, treat the
secret as exposed and generate a new one for `.env`.

## 3. Install esbuild

Nextly reads `nextly.config.ts` with esbuild, an optional peer dependency the
generator does not add. Without it nothing in the config loads, and the dev
server logs `Reading "nextly.config.ts" needs the "esbuild" package`.

```bash
npm install -D esbuild      # or: pnpm add -D esbuild / yarn add -D esbuild / bun add -d esbuild
```

## 4. Add the admin's media route

The admin's media library calls `/admin/api/media`, which the generator does
not create for an existing app. Without it, uploads in the admin fail. Create
`src/app/admin/api/media/[[...path]]/route.ts`:

```ts
import { createMediaHandlers } from "nextly/api/media-handlers";

import nextlyConfig from "../../../../../../nextly.config";

// Signed-in only: this is the route the admin uploads and edits media through.
const handlers = createMediaHandlers({
  config: nextlyConfig,
  requireAuth: true,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
```

Without a `src/` folder, the file is `app/admin/api/media/[[...path]]/route.ts`
and the import is `"../../../../../nextly.config"`. Keep the generated
`/api/media` route too: it serves reads only.

## 5. Let the admin set its theme on `<html>`

Add `suppressHydrationWarning` to `<html>` in the root layout
(`src/app/layout.tsx`). The admin sets its theme class on `<html>`, and without
the attribute every admin page load logs a hydration mismatch.

```tsx
<html lang="en" suppressHydrationWarning>
```

In development, editing the root layout while an admin page is open floods
the browser console with `Cannot read properties of null (reading
'removeChild')`. Reload the page.

## 6. Start it and create the first admin

```bash
npm run dev
```

Open `http://localhost:3000/admin/setup` and create the first account; it gets
the Super Admin role. The first request creates Nextly's own tables. Then sign
in at `/admin`.

## Check it worked

- `/admin` shows the dashboard after signing in.
- `npx nextly --version` prints the installed version.
- The dev server log has no `esbuild` error.

A log line saying no `instrumentation.ts` was detected is advice about
connection load, not an error.

## Doing it by hand

If the generator cannot be used, the manual steps are at
<https://nextlyhq.com/docs/getting-started/installation> (option B). Steps 1
and 3 to 5 above apply there too.

## Next

- Define content: the `nextly-collections` skill.
- Who can sign in and what they can do: the `nextly-authentication` skill.
- Going live: the `nextly-deploy` skill.
- Every docs page, for agents: <https://nextlyhq.com/llms.txt>.
