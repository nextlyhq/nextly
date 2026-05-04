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
  <a href="https://github.com/nextlyhq/nextly/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/nextlyhq/nextly?style=flat-square&color=blue" /></a>
  <a href="https://github.com/nextlyhq/nextly/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/nextlyhq/nextly?style=flat-square&color=yellow" /></a>
</p>

<br/>

Nextly is a TypeScript-first, Next.js-native CMS and app framework. Define your content schema in code _or_ with the visual builder, choose your database, and get a fully-typed REST + GraphQL API and a customizable admin dashboard out of the box. No SaaS, no proprietary cloud — your data, your stack.

- Define collections in TypeScript with the [**code-first config**](https://nextlyhq.com/docs/configuration/collections), or build them visually in the [**Visual Schema Builder**](https://nextlyhq.com/docs/admin/builder)
- Auto-generated [**REST**](https://nextlyhq.com/docs/api-reference/rest-api) & [**GraphQL**](https://nextlyhq.com/docs/api-reference/direct-api) APIs with full TypeScript types
- Granular [**Roles & Permissions**](https://nextlyhq.com/docs/guides/authentication) and field-level access control out of the box
- First-class [**PostgreSQL**, **MySQL**, and **SQLite**](https://nextlyhq.com/docs/database) support via pluggable adapters
- Built-in [**Media Library**](https://nextlyhq.com/docs/guides/media-storage) with **S3**, **Vercel Blob**, and **UploadThing** storage adapters
- Extensible [**plugin system**](https://nextlyhq.com/docs/plugins) and customizable admin dashboard
- 100% [**TypeScript**](https://nextlyhq.com/docs), MIT-licensed, self-hosted

> Explore all features at **[nextlyhq.com](https://nextlyhq.com)**

> [!IMPORTANT]
> Nextly is in active development heading toward v1.0. Star this repo to follow along — releases land every few weeks.

## Quickstart

```bash
pnpm create nextly-app@latest
```

That's it. Follow the prompts and you'll have a running CMS with admin panel and database in under a minute.

> Prefer a manual setup? See the [installation guide](https://nextlyhq.com/docs/getting-started/installation) for clone-and-configure instructions, Docker, and database options.

## Packages

### Core

| Package                         | Description                                               |
| ------------------------------- | --------------------------------------------------------- |
| **@revnixhq/nextly**            | Core CMS — database, services, APIs, RBAC                 |
| **@revnixhq/admin**             | Admin dashboard and management interface                  |
| **@revnixhq/client**            | Type-safe client SDK for browser-based applications       |
| **@revnixhq/ui**                | Headless UI components shared across packages and plugins |
| **@revnixhq/create-nextly-app** | CLI scaffold for new Nextly projects                      |

### Database adapters

| Package                        | Description         |
| ------------------------------ | ------------------- |
| **@revnixhq/adapter-postgres** | PostgreSQL adapter  |
| **@revnixhq/adapter-mysql**    | MySQL adapter       |
| **@revnixhq/adapter-sqlite**   | SQLite adapter      |
| **@revnixhq/adapter-drizzle**  | Drizzle ORM adapter |

### Storage adapters

| Package                           | Description                                |
| --------------------------------- | ------------------------------------------ |
| **@revnixhq/storage-s3**          | Amazon S3 (or compatible: R2, MinIO, etc.) |
| **@revnixhq/storage-vercel-blob** | Vercel Blob storage                        |
| **@revnixhq/storage-uploadthing** | UploadThing storage                        |

### Plugins

| Package                           | Description                       |
| --------------------------------- | --------------------------------- |
| **@revnixhq/plugin-form-builder** | Drag-and-drop form builder plugin |

## Requirements

| Tool    | Minimum                                                     |
| ------- | ----------------------------------------------------------- |
| Node.js | 18+ (Node 22 LTS recommended)                               |
| pnpm    | 9+ (recommended) — npm and Yarn also work                   |
| Next.js | 15+ for production; 16+ recommended for Turbopack-based dev |

### Database support

| Database                                                  | Minimum | Notes                                                                 |
| --------------------------------------------------------- | ------- | --------------------------------------------------------------------- |
| [PostgreSQL](https://nextlyhq.com/docs/database/postgres) | 15.0+   | Standard PG, Neon, Supabase, RDS, Aurora PG all supported.            |
| [MySQL](https://nextlyhq.com/docs/database/mysql)         | 8.0+    | MariaDB, TiDB, Aurora MySQL, PlanetScale, Vitess work on best-effort. |
| [SQLite](https://nextlyhq.com/docs/database/sqlite)       | 3.38+   | Bundled with `better-sqlite3`.                                        |

See the [database support docs](https://nextlyhq.com/docs/database) for full version policy and cloud-provider notes.

## Documentation

- [**Installation**](https://nextlyhq.com/docs/getting-started/installation) — get started in minutes
- [**Concepts**](https://nextlyhq.com/docs/configuration) — collections, fields, hooks, access control
- [**Authentication & permissions**](https://nextlyhq.com/docs/guides/authentication) — RBAC, API keys, JWT
- [**API reference**](https://nextlyhq.com/docs/api-reference/rest-api) — REST and GraphQL
- [**Direct API**](https://nextlyhq.com/docs/api-reference/direct-api) — programmatic Node.js access
- [**Database**](https://nextlyhq.com/docs/database) — Postgres, MySQL, SQLite adapters
- [**Admin customization**](https://nextlyhq.com/docs/admin/customization) — extend the dashboard
- [**Plugin development**](https://nextlyhq.com/docs/plugins) — build your own integrations

## Community

- [**GitHub Discussions**](https://github.com/nextlyhq/nextly/discussions) — questions, ideas, show-and-tell
- [**Issues**](https://github.com/nextlyhq/nextly/issues) — bug reports and feature requests
- [**Contributing guide**](./CONTRIBUTING.md) — local setup, development workflow, conventions
- [**Code of Conduct**](./CODE_OF_CONDUCT.md) — how we behave as a community

## Contributing

Contributions of every size are welcome — from typo fixes to new database adapters. Start with the [Contributing guide](./CONTRIBUTING.md) for local setup, the development workflow, and our PR/commit conventions. First-time contributors should look for issues tagged [`good first issue`](https://github.com/nextlyhq/nextly/labels/good%20first%20issue).

## Telemetry

The Nextly CLI (`create-nextly-app` and `nextly`) collects anonymous usage data to help us improve the tool. No personal information, project contents, file paths, or secrets are collected. Telemetry is automatically disabled in CI, Docker, production, and non-interactive shells.

See [nextlyhq.com/docs/telemetry](https://nextlyhq.com/docs/telemetry) for the full list of what is and is not collected, and for instructions on opting out (`nextly telemetry disable` or `NEXTLY_TELEMETRY_DISABLED=1`).

## License

[MIT](./LICENSE) — free to use, modify, and distribute.
