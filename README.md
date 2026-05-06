<!-- Add a social preview image at GitHub repo Settings → Social preview to control the link card shown when this repo is shared. -->

<p align="center">
  <a href="https://nextlyhq.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./.github/assets/logo-dark-mode.svg">
      <img alt="Nextly" src="./.github/assets/logo.svg" width="100">
    </picture>
  </a>
</p>

<h1 align="center">Nextly</h1>

<h3 align="center">The open-source CMS and app framework for Next.js</h3>

<p align="center">
  Code-first or visual schema builder. Type-safe APIs.<br/>
  Self-hosted, MIT-licensed, no vendor lock-in.
</p>

<p align="center">
  <a href="https://nextlyhq.com/docs"><strong>Docs</strong></a> ·
  <a href="https://github.com/nextlyhq/nextly/discussions"><strong>Discussions</strong></a> ·
  <a href="https://github.com/nextlyhq/nextly/issues"><strong>Issues</strong></a> ·
  <a href="https://nextlyhq.com"><strong>Website</strong></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@revnixhq/nextly"><img alt="npm" src="https://img.shields.io/npm/v/@revnixhq/nextly?style=flat-square&label=npm&color=cb3837" /></a>
  <a href="https://github.com/nextlyhq/nextly/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/nextlyhq/nextly/ci.yml?branch=main&style=flat-square&label=CI" /></a>
  <a href="https://github.com/nextlyhq/nextly/blob/main/LICENSE.md"><img alt="License" src="https://img.shields.io/github/license/nextlyhq/nextly?style=flat-square&color=blue" /></a>
  <a href="https://github.com/nextlyhq/nextly/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/nextlyhq/nextly?style=flat-square&color=yellow" /></a>
  <a href="https://github.com/nextlyhq/nextly/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/nextlyhq/nextly?style=flat-square&color=green" /></a>
</p>

<br/>

> [!IMPORTANT]
> Nextly is in alpha. APIs may change before 1.0. Pin exact versions in production.

Nextly is a TypeScript-first, Next.js-native CMS and app framework. Define your content schema in code or with the visual builder, choose your database, and get a fully-typed REST and Direct API plus a customizable admin dashboard out of the box. No SaaS, no proprietary cloud, your data, your stack.

## Why Nextly?

|                                                                                                                                     |                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Code-first or visual schema.** Define collections in TypeScript, or build them in the Schema Builder. Same data model either way. | **Type-safe everywhere.** REST API, Direct API, and admin UI are fully typed end to end. |
| **Pluggable databases.** PostgreSQL, MySQL, SQLite via official adapters. Add your own with the adapter base.                       | **Pluggable storage.** S3 (and R2, MinIO), Vercel Blob, UploadThing for media.           |
| **Granular access control.** Roles, permissions, and field-level access out of the box.                                             | **Self-hosted, MIT-licensed.** Your stack, your data, no vendor lock-in.                 |

<!-- Hero visual pending: see docs/superpowers/specs/2026-05-06-readme-anatomy-design.md §11.4 -->

## Quickstart

```bash
pnpm create-nextly-app@latest
```

That's it. Follow the prompts and you'll have a running CMS with admin panel and database in under a minute.

> Prefer a manual setup? See the [installation guide](https://nextlyhq.com/docs/getting-started/installation) for clone-and-configure instructions, Docker, and database options.

## A tiny example

A minimal `nextly.config.ts` that defines a `posts` collection and exposes a typed API:

```ts
import {
  defineConfig,
  defineCollection,
  text,
  richText,
  relationship,
} from "@revnixhq/nextly/config";

const Posts = defineCollection({
  slug: "posts",
  fields: [
    text({ name: "title", required: true }),
    richText({ name: "body" }),
    relationship({ name: "author", relationTo: "users" }),
  ],
});

export default defineConfig({
  collections: [Posts],
});
```

Set `DATABASE_URL` (and optionally `DB_DIALECT`) in your `.env`; Nextly picks the dialect automatically. `Posts.title` and `Posts.body` are typed end to end, queryable via REST or Direct API, and editable from the admin panel.

## Packages

### Core

| Package                         | Description                                               |
| ------------------------------- | --------------------------------------------------------- |
| **@revnixhq/nextly**            | Core CMS: database, services, APIs, RBAC                  |
| **@revnixhq/admin**             | Admin dashboard and management interface                  |
| **@revnixhq/client**            | Type-safe client SDK for browser-based applications       |
| **@revnixhq/ui**                | Headless UI components shared across packages and plugins |
| **@revnixhq/create-nextly-app** | CLI scaffold for new Nextly projects                      |

### Database adapters

| Package                        | Description                                                        |
| ------------------------------ | ------------------------------------------------------------------ |
| **@revnixhq/adapter-postgres** | PostgreSQL adapter                                                 |
| **@revnixhq/adapter-mysql**    | MySQL adapter                                                      |
| **@revnixhq/adapter-sqlite**   | SQLite adapter                                                     |
| **@revnixhq/adapter-drizzle**  | Drizzle ORM adapter base (most users do not install this directly) |

### Storage adapters

| Package                           | Description                            |
| --------------------------------- | -------------------------------------- |
| **@revnixhq/storage-s3**          | Amazon S3 (also R2, MinIO, B2, Wasabi) |
| **@revnixhq/storage-vercel-blob** | Vercel Blob storage                    |
| **@revnixhq/storage-uploadthing** | UploadThing storage                    |

### Plugins

| Package                           | Description                       |
| --------------------------------- | --------------------------------- |
| **@revnixhq/plugin-form-builder** | Drag-and-drop form builder plugin |

## Requirements

| Tool    | Minimum                                                     |
| ------- | ----------------------------------------------------------- |
| Node.js | 18+ (Node 22 LTS recommended)                               |
| pnpm    | 9+ recommended; npm and Yarn also work                      |
| Next.js | 15+ for production; 16+ recommended for Turbopack-based dev |

### Database support

| Database                                                  | Minimum | Notes                                                                 |
| --------------------------------------------------------- | ------- | --------------------------------------------------------------------- |
| [PostgreSQL](https://nextlyhq.com/docs/database/postgres) | 15.0+   | Standard PG, Neon, Supabase, RDS, Aurora PG all supported.            |
| [MySQL](https://nextlyhq.com/docs/database/mysql)         | 8.0+    | MariaDB, TiDB, Aurora MySQL, PlanetScale, Vitess work on best-effort. |
| [SQLite](https://nextlyhq.com/docs/database/sqlite)       | 3.38+   | Bundled with `better-sqlite3`.                                        |

See the [database support docs](https://nextlyhq.com/docs/database) for full version policy and cloud-provider notes.

## Documentation

- [**Installation**](https://nextlyhq.com/docs/getting-started/installation): get started in minutes
- [**Concepts**](https://nextlyhq.com/docs/configuration): collections, fields, hooks, access control
- [**Authentication & permissions**](https://nextlyhq.com/docs/guides/authentication): RBAC, API keys, JWT
- [**API reference**](https://nextlyhq.com/docs/api-reference/rest-api): REST and Direct API
- [**Database**](https://nextlyhq.com/docs/database): Postgres, MySQL, SQLite adapters
- [**Admin customization**](https://nextlyhq.com/docs/admin/customization): extend the dashboard
- [**Plugin development**](https://nextlyhq.com/docs/plugins): build your own integrations

## Examples

- [**Blog template**](./templates/blog) (15 seeded posts, RSS, sitemap, search)
- [**Playground app**](./apps/playground) (development sandbox used by maintainers)

## How Nextly compares

Nextly draws inspiration from each of these projects. Use the table to find the best tool for your situation. If you would rather have a hosted SaaS-style CMS, Sanity and Contentful are stronger picks; this comparison focuses on self-hostable open source frameworks.

| Dimension                  | Nextly                  | Payload                   | Strapi                           | Directus                        |
| -------------------------- | ----------------------- | ------------------------- | -------------------------------- | ------------------------------- |
| License                    | MIT                     | MIT                       | OSL-3.0 / EE                     | BSL 1.1                         |
| Hosted in your Next.js app | yes                     | yes                       | no (separate server)             | no (separate server)            |
| Code-first schema          | yes                     | yes                       | partial                          | no                              |
| Visual schema builder      | yes                     | no                        | yes                              | yes                             |
| Database options           | Postgres, MySQL, SQLite | Postgres, MongoDB, SQLite | Postgres, MySQL, SQLite, MongoDB | Postgres, MySQL, SQLite, others |
| Type-safety end to end     | yes                     | yes                       | partial                          | partial                         |
| Plugin system              | yes                     | yes                       | yes                              | yes                             |
| Direct (in-process) API    | yes                     | yes                       | no                               | no                              |

## Roadmap

See [`nextlyhq.com/roadmap`](https://nextlyhq.com/roadmap) for what's next.

## Community

- [**GitHub Discussions**](https://github.com/nextlyhq/nextly/discussions) for questions, ideas, and show-and-tell
- [**Issues**](https://github.com/nextlyhq/nextly/issues) for bug reports and feature requests
- [**Discord**](https://discord.gg/hJUg9AZMn) for real-time chat with the team and other users
- [**Contributing guide**](./CONTRIBUTING.md) for local setup, the dev workflow, and PR conventions
- [**Code of Conduct**](./CODE_OF_CONDUCT.md) for how we behave as a community

## Contributing

Contributions of every size are welcome, from typo fixes to new database adapters. Start with the [Contributing guide](./CONTRIBUTING.md) for local setup, the development workflow, and our PR/commit conventions.

## Telemetry

The Nextly CLI (`create-nextly-app` and `nextly`) collects anonymous usage data to help us improve the tool. No personal information, project contents, file paths, or secrets are collected. Telemetry is automatically disabled in CI, Docker, production, and non-interactive shells.

See [nextlyhq.com/docs/telemetry](https://nextlyhq.com/docs/telemetry) for the full list of what is and is not collected, and for instructions on opting out (`nextly telemetry disable` or `NEXTLY_TELEMETRY_DISABLED=1`).

## License

[MIT](./LICENSE.md). Free to use, modify, and distribute.
