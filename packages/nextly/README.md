# @revnixhq/nextly

A modern, type-safe headless CMS for Next.js. Define your content schema with code-first configuration or the visual schema builder, then consume it through a typed API in your app.

## Quickstart

Scaffold a new Nextly project:

```bash
npx @revnixhq/create-nextly-app@latest
# or
pnpm dlx @revnixhq/create-nextly-app@latest
# or
yarn dlx @revnixhq/create-nextly-app
```

Or add Nextly to an existing Next.js app:

```bash
pnpm add @revnixhq/nextly @revnixhq/admin @revnixhq/adapter-postgres
```

A minimal `nextly.config.ts`:

```typescript
import {
  defineConfig,
  defineCollection,
  text,
  richText,
} from "@revnixhq/nextly/config";

const Posts = defineCollection({
  slug: "posts",
  fields: [text({ name: "title", required: true }), richText({ name: "body" })],
});

export default defineConfig({
  collections: [Posts],
});
```

Database connection is configured via `DATABASE_URL` plus a database adapter package — see the [adapter docs](https://nextlyhq.com/docs/database).

See the [documentation](https://nextlyhq.com/docs) for the full configuration reference, the visual schema builder, plugins, and deploy guides.

## Features

- **Code-first or visual schema** — author collections in TypeScript or in the admin UI
- **Type-safe Direct API** — `nextly.collections.find(...)` with end-to-end inferred types
- **Pluggable database adapters** — PostgreSQL, MySQL, SQLite (Drizzle-backed)
- **Pluggable storage adapters** — local disk, S3 / R2 / MinIO, Vercel Blob, UploadThing
- **Built-in admin dashboard** — `@revnixhq/admin` ships ready-to-mount React components
- **Role-based access control** — entities, permissions, per-field access rules
- **Lifecycle hooks** — beforeCreate / afterUpdate / etc. for custom workflows
- **Plugin system** — type-safe plugin context with access to services and hooks
- **Auth** — first-party email/password + session management
- **Media library** — folder hierarchy, bulk operations, image processing via Sharp
- **CLI-driven migrations** — `.sql` files in repo, applied in CI before deploy

## Database adapters

Pick the adapter for your database — the rest of Nextly is the same regardless of dialect:

| Database   | Package                                             | Notes                                                     |
| ---------- | --------------------------------------------------- | --------------------------------------------------------- |
| PostgreSQL | [`@revnixhq/adapter-postgres`](../adapter-postgres) | 15+. Auto-detects Neon / Supabase / RDS.                  |
| MySQL      | [`@revnixhq/adapter-mysql`](../adapter-mysql)       | 8+. MariaDB / Aurora / PlanetScale recognized at connect. |
| SQLite     | [`@revnixhq/adapter-sqlite`](../adapter-sqlite)     | 3.38+. Bundled `better-sqlite3`.                          |

## Storage adapters

| Backend                                 | Package                                                   |
| --------------------------------------- | --------------------------------------------------------- |
| AWS S3 / Cloudflare R2 / MinIO / Spaces | [`@revnixhq/storage-s3`](../storage-s3)                   |
| Vercel Blob                             | [`@revnixhq/storage-vercel-blob`](../storage-vercel-blob) |
| UploadThing                             | [`@revnixhq/storage-uploadthing`](../storage-uploadthing) |

Local disk is the default and requires no adapter package.

## Production migrations

Nextly ships a CLI-driven migration workflow. Schema changes land as committed `.sql` files; CI applies them before the new app code is deployed. The deployed app never alters schema.

```bash
# Local: edit nextly.config.ts, generate the migration
pnpm exec nextly migrate:create --name=add_excerpt

# CI: verify integrity + apply against $DATABASE_URL
pnpm exec nextly migrate:check
pnpm exec nextly migrate

# Then deploy your app
```

See the [production migrations guide](https://nextlyhq.com/docs/guides/production-migrations) for Vercel + GitHub Actions and other platform recipes.

## Requirements

| Tool    | Minimum                                           |
| ------- | ------------------------------------------------- |
| Node.js | 18+ (Node 22 LTS is what we test against)         |
| Next.js | 14+ for production; 16+ recommended for Turbopack |
| pnpm    | 8+                                                |

## Related packages

- [`@revnixhq/admin`](../admin) — admin dashboard React components
- [`@revnixhq/ui`](../ui) — headless UI primitives shared by admin + plugins
- [`@revnixhq/client`](../client) — browser SDK (in development)
- [`@revnixhq/plugin-form-builder`](../plugin-form-builder) — drag-and-drop form builder plugin

## Documentation

Full docs: **[nextlyhq.com/docs](https://nextlyhq.com/docs)**

## Contributing

Issues and PRs welcome at [github.com/nextlyhq/nextly](https://github.com/nextlyhq/nextly). See the root [CONTRIBUTING.md](https://github.com/nextlyhq/nextly/blob/dev/CONTRIBUTING.md) for setup, conventions, and how to run the test suite.

## Governance

- [Security policy](https://github.com/nextlyhq/nextly/blob/dev/SECURITY.md) — report vulnerabilities privately
- [Code of Conduct](https://github.com/nextlyhq/nextly/blob/dev/CODE_OF_CONDUCT.md)
- [License (MIT)](./LICENSE)
