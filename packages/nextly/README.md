# @revnixhq/nextly

The core Nextly package: collection runtime, database services, REST and Direct APIs, RBAC, hooks, and the plugin system. Every Nextly project depends on this.

<p align="center">
  <a href="https://www.npmjs.com/package/@revnixhq/nextly"><img alt="npm" src="https://img.shields.io/npm/v/@revnixhq/nextly?style=flat-square&label=npm&color=cb3837" /></a>
  <a href="https://github.com/nextlyhq/nextly/blob/main/LICENSE.md"><img alt="License" src="https://img.shields.io/github/license/nextlyhq/nextly?style=flat-square&color=blue" /></a>
  <a href="https://nextlyhq.com/docs"><img alt="Status" src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" /></a>
</p>

> [!IMPORTANT]
> Nextly is in alpha. APIs may change before 1.0. Pin exact versions in production.

## Why Nextly?

|                                                                                                                                     |                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Code-first or visual schema.** Define collections in TypeScript, or build them in the Schema Builder. Same data model either way. | **Type-safe everywhere.** REST API, Direct API, and admin UI are fully typed end to end. |
| **Pluggable databases.** PostgreSQL, MySQL, SQLite via official adapters. Add your own with the adapter base.                       | **Pluggable storage.** S3 (and R2, MinIO), Vercel Blob, UploadThing for media.           |
| **Granular access control.** Roles, permissions, and field-level access out of the box.                                             | **Self-hosted, MIT-licensed.** Your stack, your data, no vendor lock-in.                 |

<!-- Hero visual pending: see docs/superpowers/specs/2026-05-06-readme-anatomy-design.md §11.4 -->

## Quickstart

Add Nextly to an existing Next.js app:

```bash
pnpm add @revnixhq/nextly @revnixhq/admin @revnixhq/adapter-postgres pg
```

Or scaffold a fresh project (recommended for first-time use):

```bash
pnpm create-nextly-app@latest
```

## A tiny example

Define a `posts` collection in `nextly.config.ts`:

```ts
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

Set `DATABASE_URL` in `.env`; Nextly selects the dialect from the URL protocol or from `DB_DIALECT`. See the [database docs](https://nextlyhq.com/docs/database) for adapter selection.

Read the collection from a server component or route handler via the Direct API:

```ts
// app/api/posts/route.ts
import { getNextly } from "@revnixhq/nextly";
import nextlyConfig from "@nextly-config";

export async function GET() {
  const nextly = await getNextly({ config: nextlyConfig });
  const result = await nextly.find({ collection: "posts", limit: 10 });
  return Response.json(result);
}
```

`Posts.title` and `Posts.body` are typed end to end, queryable via REST or Direct API, and editable from the admin panel.

## Documentation

- [**Installation**](https://nextlyhq.com/docs/getting-started/installation)
- [**Configuration**](https://nextlyhq.com/docs/configuration/nextly-config)
- [**Collections**](https://nextlyhq.com/docs/configuration/collections)
- [**Fields**](https://nextlyhq.com/docs/configuration/fields)
- [**Direct API**](https://nextlyhq.com/docs/api-reference/direct-api)
- [**REST API**](https://nextlyhq.com/docs/api-reference/rest-api)
- [**Authentication & permissions**](https://nextlyhq.com/docs/guides/authentication)
- [**Plugin development**](https://nextlyhq.com/docs/plugins)

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

_The `nextly` npm package name was kindly transferred by [Hamin Lee](https://hmart.app/en/). [Read the small story →](https://mobeenabdullah.com/blog/a-small-npm-story-from-pakistan-to-seoul)._
