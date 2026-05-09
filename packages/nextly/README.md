# nextly

The core Nextly package: collection runtime, database services, REST and Direct APIs, RBAC, hooks, and the plugin system. Every Nextly project depends on this.

<p align="center">
  <a href="https://www.npmjs.com/package/nextly"><img alt="npm" src="https://img.shields.io/npm/v/nextly?style=flat-square&label=npm&color=cb3837" /></a>
  <a href="https://github.com/nextlyhq/nextly/blob/main/LICENSE.md"><img alt="License" src="https://img.shields.io/github/license/nextlyhq/nextly?style=flat-square&color=blue" /></a>
  <a href="https://nextlyhq.com/docs"><img alt="Status" src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" /></a>
</p>

> [!IMPORTANT]
> Nextly is in alpha. APIs may change before 1.0. Pin exact versions in production.

## Why Nextly?

- **Code-first or visual schema.** Define collections in TypeScript, or build them in the Schema Builder. Same data model either way.
- **Type-safe everywhere.** REST API, Direct API, and the admin UI are typed end-to-end.
- **Pluggable databases.** PostgreSQL, MySQL, SQLite via official adapters.
- **Pluggable storage.** Local disk by default; S3 (and R2, MinIO), Vercel Blob, or UploadThing for production.
- **Granular access control.** Roles, permissions, and field-level access out of the box.
- **Self-hosted, MIT-licensed.** Your stack, your data, no vendor lock-in.

## Quickstart

The fastest path is the CLI:

```bash
pnpm create nextly-app my-app
```

Or add Nextly to an existing Next.js app:

```bash
# Runtime and admin
pnpm add nextly @nextlyhq/admin

# Plus the database adapter and driver you want
pnpm add @nextlyhq/adapter-postgres pg               # PostgreSQL
# or
pnpm add @nextlyhq/adapter-mysql mysql2              # MySQL
# or
pnpm add @nextlyhq/adapter-sqlite better-sqlite3     # SQLite (local demos)
```

See the [installation guide](https://nextlyhq.com/docs/getting-started/installation) for the full setup: admin routes, environment variables, and the first-run migration.

## A tiny example

Define a `posts` collection in `nextly.config.ts`:

```ts
import { defineConfig } from "nextly/config";
import { defineCollection, text, richText } from "nextly";

const Posts = defineCollection({
  slug: "posts",
  fields: [text({ name: "title", required: true }), richText({ name: "body" })],
});

export default defineConfig({
  collections: [Posts],
});
```

Set `DATABASE_URL` in `.env`; Nextly selects the dialect from the URL protocol or from `DB_DIALECT`. See the [database docs](https://nextlyhq.com/docs/database) for adapter selection.

Read the collection from a Server Component or route handler via the Direct API:

```ts
// app/api/posts/route.ts
import { getNextly } from "nextly";
import nextlyConfig from "@nextly-config";

export async function GET() {
  const nextly = await getNextly({ config: nextlyConfig });
  const result = await nextly.find({ collection: "posts", limit: 10 });
  return Response.json(result);
}
```

The `@nextly-config` path alias is configured automatically by `create-nextly-app` and by the manual setup steps in the docs. It resolves to your project's `nextly.config.ts` from anywhere in your codebase, so you do not write fragile relative paths.

## Documentation

- [**Installation**](https://nextlyhq.com/docs/getting-started/installation)
- [**Configuration**](https://nextlyhq.com/docs/configuration/nextly-config)
- [**Collections**](https://nextlyhq.com/docs/configuration/collections)
- [**Singles**](https://nextlyhq.com/docs/configuration/singles)
- [**Fields**](https://nextlyhq.com/docs/configuration/fields)
- [**Direct API**](https://nextlyhq.com/docs/api-reference/direct-api)
- [**REST API**](https://nextlyhq.com/docs/api-reference/rest-api)
- [**Authentication & permissions**](https://nextlyhq.com/docs/guides/authentication)
- [**Plugin development**](https://nextlyhq.com/docs/plugins)

## Related packages

- [`@nextlyhq/admin`](https://github.com/nextlyhq/nextly/tree/main/packages/admin): the admin dashboard and Schema Builder
- [`@nextlyhq/ui`](https://github.com/nextlyhq/nextly/tree/main/packages/ui): the headless component library
- [`@nextlyhq/adapter-postgres`](https://github.com/nextlyhq/nextly/tree/main/packages/adapter-postgres) (recommended), [`@nextlyhq/adapter-mysql`](https://github.com/nextlyhq/nextly/tree/main/packages/adapter-mysql), [`@nextlyhq/adapter-sqlite`](https://github.com/nextlyhq/nextly/tree/main/packages/adapter-sqlite): database adapters
- [`@nextlyhq/storage-s3`](https://github.com/nextlyhq/nextly/tree/main/packages/storage-s3), [`@nextlyhq/storage-vercel-blob`](https://github.com/nextlyhq/nextly/tree/main/packages/storage-vercel-blob), [`@nextlyhq/storage-uploadthing`](https://github.com/nextlyhq/nextly/tree/main/packages/storage-uploadthing): media storage adapters
- [`create-nextly-app`](https://github.com/nextlyhq/nextly/tree/main/packages/create-nextly-app): the project scaffolder

See the [monorepo](https://github.com/nextlyhq/nextly) for the full ecosystem.

## Community

- [**GitHub Discussions**](https://github.com/nextlyhq/nextly/discussions) for questions, ideas, and show-and-tell
- [**Issues**](https://github.com/nextlyhq/nextly/issues) for bug reports and feature requests
- [**Discord**](https://discord.gg/hJUg9AZMn) for real-time chat with the team and other users
- [**Contributing guide**](https://github.com/nextlyhq/nextly/blob/main/CONTRIBUTING.md) for local setup, the dev workflow, and PR conventions

## Contributing

Contributions of every size are welcome. Start with the [Contributing guide](https://github.com/nextlyhq/nextly/blob/main/CONTRIBUTING.md) for local setup and PR conventions.

## License

[MIT](https://github.com/nextlyhq/nextly/blob/main/LICENSE.md). Free to use, modify, and distribute.

---

_The `nextly` npm package name was kindly transferred by [Hamin Lee](https://hmart.app/en/). [Read the small story.](https://mobeenabdullah.com/blog/a-small-npm-story-from-pakistan-to-seoul)_
