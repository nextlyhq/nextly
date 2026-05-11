# Playground

Internal contributor playground for the Nextly monorepo. NOT a template for end-user projects - see [`templates/blog`](../../templates/blog) for that.

## What this is

A pre-wired Next.js app that hosts the Nextly admin at `/admin` and exercises the most-used surfaces of the framework: text fields, slug fields, rich text, relationships (one-to-many and many-to-many), upload fields, dates, and selects. Edits to `packages/*` source files hot-reload here through workspace dependencies.

## Run it

From the monorepo root:

```bash
pnpm install
pnpm dev:app
```

The wrapper at `scripts/dev-playground.mjs` runs pre-flight checks (workspace symlinks, `.env` presence, build artifacts, port availability), auto-fixes what it can, then spawns `next dev`. If something can't be auto-fixed you get a specific actionable error before Next.js starts.

On a fresh clone the wrapper will:

- **Auto-create `.env`** by copying `apps/playground/.env.example` (safe defaults: SQLite, dev secrets — edit afterward if you want to customize).
- **Auto-build workspace packages** with `pnpm turbo build --filter='./packages/*'` if no `dist/` outputs exist yet. This adds ~30s on first boot only; turbo's cache makes subsequent boots a no-op. Without this step the seed sub-process can't import the framework runtime and `/admin` returns HTTP 500.

Visit [http://localhost:3000](http://localhost:3000) - `/` redirects to `/admin`.

## Switching databases

The default `.env.example` uses SQLite at `apps/playground/data/playground.db`. No Docker, no external services. To switch:

- `pnpm dev:postgres` - Postgres (auto-starts the Docker container if it isn't already up). _Coming in task 6.7._
- `pnpm dev:mysql` - MySQL. _Coming in task 6.7._

The dev scripts override `DB_DIALECT` and `DATABASE_URL` for the run; your `.env` is left alone.

## What's wired up

- **Admin** - mounted at `app/admin/[[...params]]/page.tsx` via `<RootLayout />` from `@nextlyhq/admin`.
- **Collections** - three demo collections defined in `src/collections/`:
  - `Posts` - title, slug, excerpt, rich-text content, categories (relation), tags (relation), featuredImage (upload), publishedAt, status (draft/published).
  - `Categories` - title, slug, description.
  - `Tags` - title, slug, description.
- **Storage** - falls through to the local-disk adapter built into `nextly` when no cloud env vars are set. Uploads go to `apps/playground/public/uploads/` (gitignored).
- **Plugins** - none. The playground stays minimal so a broken plugin can't break the playground.

## Collection field choices

The three collections explicitly declare `title` and `slug` even though Nextly auto-injects those columns when you omit them. We declare them anyway so:

- `slug` can have `unique: true` (the auto-inject is plain `text NOT NULL` with no uniqueness)
- `title` and `slug` appear in the admin create/edit form (auto-injected columns are database-only)
- Future hooks/validation can attach to them
- The collection file is self-documenting without requiring framework knowledge

See [`/docs/configuration/collections#system-fields`](../../docs/configuration/collections.mdx) for the full breakdown.

`id`, `createdAt`, and `updatedAt` are always auto-injected - never declare them.

## Resetting state

To wipe local DB + uploads + caches and re-seed:

```bash
pnpm dev:reset
```

_Coming in task 6.6._

## Internal scripts

- `pnpm dev:app` - wrapper → doctor → next dev. SQLite by default.
- `pnpm dev:doctor` - pre-flight checks only, no boot.
- `pnpm test` / `pnpm test:watch` - vitest for the helper scripts under `scripts/__tests__/`.
- `pnpm db:push` / `pnpm db:studio` / `pnpm db:generate` - passthroughs to `nextly`.

## Files of interest

```
apps/playground/
├── nextly.config.ts             # framework config - collections, branding
├── src/
│   ├── collections/             # demo collection definitions
│   │   ├── posts.ts
│   │   ├── categories.ts
│   │   └── tags.ts
│   └── app/
│       ├── page.tsx             # redirects to /admin
│       └── admin/
│           ├── [[...params]]/page.tsx   # admin shell
│           └── api/[[...params]]/route.ts # admin API catch-all
├── scripts/__tests__/           # vitest tests for the dev helpers
└── .env.example                 # SQLite default
```
