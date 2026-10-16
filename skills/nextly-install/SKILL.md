---
name: nextly-install
description: >-
  Use when adding Nextly, the open-source CMS that runs inside a Next.js app,
  to an existing Next.js App Router project: installing its packages,
  creating nextly.config.ts, mounting the admin panel at /admin, choosing a
  database, and creating the first admin account. Also use when an existing
  Nextly install shows no collections, fails to load nextly.config.ts, or its
  admin panel misbehaves after setup.
---

# Install Nextly into an existing Next.js app

Nextly runs inside the app: same server, same database, no separate service.
The project generator detects an existing Next.js app and installs Nextly into
it. A few steps after it are needed on the current release; do all of them.

Checked against `nextly` 0.0.2-alpha.66 with Next.js 16.4. Run
`npx nextly --version` after installing; if it prints a newer version, prefer
<https://nextlyhq.com/docs> where it disagrees with this skill.

## Before you start

- Next.js 16 with the App Router (`app/` or `src/app/`). The package also
  accepts Next.js 14 and 15.
- Node.js `^20.19.0 || ^22.12.0 || >=24.0.0`. Node 23 is not supported.
- A clean git working tree, so every change below is visible in one diff.

## 1. Run the generator in the project root

```bash
npx create-nextly-app@alpha          # npm
pnpm dlx create-nextly-app@alpha     # pnpm
yarn dlx create-nextly-app@alpha     # yarn
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

What it changes:

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

## 2. Install esbuild

Nextly reads `nextly.config.ts` with esbuild, an optional peer dependency the
generator does not add. Without it nothing in the config loads, and the dev
server logs `Reading "nextly.config.ts" needs the "esbuild" package`.

```bash
npm install -D esbuild      # or: pnpm add -D esbuild / yarn add -D esbuild / bun add -d esbuild
```

## 3. On pnpm 10 or later, allow the native builds

pnpm blocks dependency build scripts by default, and `better-sqlite3` then has
no compiled binding. Add this to `pnpm-workspace.yaml` (create it with
`packages: []` if the project has none), then run `pnpm install` again:

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

pnpm 11 reads `allowBuilds`; pnpm 10.6+ reads `onlyBuiltDependencies`. npm,
yarn and bun need nothing here.

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
<https://nextlyhq.com/docs/getting-started/installation> (option B). Steps 2 to
5 above apply there too.

## Next

- Define content: the `nextly-collections` skill.
- Who can sign in and what they can do: the `nextly-authentication` skill.
- Going live: the `nextly-deploy` skill.
- Every docs page, for agents: <https://nextlyhq.com/llms.txt>.
