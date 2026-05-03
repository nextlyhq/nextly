<!--
  TODO before launch:
  - Replace BANNER_URL with a hosted banner image (1280x640 recommended).
    Easiest: drop the file in .github/assets/banner.png and use the raw URL,
    or upload to a Vercel Blob / Cloudflare CDN.
  - Replace OG image URL in social preview (Settings → Social preview).
-->

<p align="center">
  <a href="https://nextlyhq.com">
    <img src="https://raw.githubusercontent.com/nextlyhq/nextly/main/.github/assets/banner.png" width="100%" alt="Nextly — open-source CMS and app framework for Next.js" />
  </a>
</p>

<h3 align="center">The open-source CMS and app framework for Next.js</h3>
<p align="center">Code-first or visual schema builder. Type-safe APIs. Self-hosted, MIT-licensed, no vendor lock-in.</p>

<p align="center">
  <a href="https://nextlyhq.com/docs"><strong>Docs</strong></a> ·
  <a href="https://github.com/nextlyhq/nextly/discussions"><strong>Discussions</strong></a> ·
  <a href="https://github.com/nextlyhq/nextly/issues"><strong>Issues</strong></a> ·
  <a href="https://nextlyhq.com"><strong>Website</strong></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@revnixhq/nextly"><img alt="npm" src="https://img.shields.io/npm/v/@revnixhq/nextly?style=flat-square&color=0070f3" /></a>
  &nbsp;
  <a href="https://github.com/nextlyhq/nextly/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/nextlyhq/nextly?style=flat-square&color=0070f3" /></a>
  &nbsp;
  <a href="https://github.com/nextlyhq/nextly/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/nextlyhq/nextly/ci.yml?branch=main&style=flat-square" /></a>
  &nbsp;
  <a href="https://github.com/nextlyhq/nextly/graphs/contributors"><img alt="Contributors" src="https://img.shields.io/github/contributors-anon/nextlyhq/nextly?style=flat-square&color=yellow" /></a>
  &nbsp;
  <a href="https://github.com/nextlyhq/nextly/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/nextlyhq/nextly?style=flat-square&color=yellow" /></a>
  &nbsp;
  <a href="https://www.npmjs.com/package/@revnixhq/nextly"><img alt="Downloads" src="https://img.shields.io/npm/dm/@revnixhq/nextly?style=flat-square" /></a>
</p>

<hr/>

> [!IMPORTANT]
> Nextly is in active development. Star this repo to follow along — releases land every few weeks.

Nextly is a TypeScript-first, Next.js-native CMS and app framework. Define your content schema in code or with the visual builder, choose your database, and get a fully-typed REST + GraphQL API and a customizable admin dashboard out of the box. No SaaS, no proprietary cloud — your data, your stack.

## Why Nextly

- **Next.js native** — runs inside your existing `/app` folder, no separate backend service to deploy.
- **Code-first or UI-first schema** — define collections with TypeScript config, _or_ build them visually in the admin. Both produce the same on-disk source of truth.
- **Type-safe by default** — TypeScript types are generated from your schema, so client SDKs, API responses, and form inputs are all checked at compile time.
- **Bring your own database** — first-class support for PostgreSQL, MySQL, and SQLite. Pluggable adapter system for Drizzle and beyond.
- **Pluggable storage** — S3, Vercel Blob, UploadThing supported out of the box. Swap providers without touching application code.
- **Granular RBAC** — roles, permissions, and field-level access control built in.
- **Extensible plugin system** — drop-in plugins for forms, SEO, search, and more. Build your own with full access to the admin UI and server runtime.
- **MIT licensed, self-hosted** — no vendor lock-in, no metered API calls, no surprise pricing.

## Quickstart

```bash
pnpm create nextly-app@latest
```

Follow the prompts, and you'll have a running CMS with admin panel and database in under a minute.

> Prefer a manual setup? See the [installation guide](https://nextlyhq.com/docs/installation) for clone-and-configure instructions, Docker setup, and database options.

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

| Database   | Minimum | Notes                                                                 |
| ---------- | ------- | --------------------------------------------------------------------- |
| PostgreSQL | 15.0+   | Standard PG, Neon, Supabase, RDS, Aurora PG all supported.            |
| MySQL      | 8.0+    | MariaDB, TiDB, Aurora MySQL, PlanetScale, Vitess work on best-effort. |
| SQLite     | 3.38+   | Bundled with `better-sqlite3`.                                        |

See the [database support docs](https://nextlyhq.com/docs/database/support) for full version policy and cloud-provider notes.

## Documentation

- [**Installation**](https://nextlyhq.com/docs/installation) — get started in minutes
- [**Concepts**](https://nextlyhq.com/docs/concepts) — collections, fields, hooks, access control
- [**API reference**](https://nextlyhq.com/docs/api) — REST and GraphQL
- [**Admin customization**](https://nextlyhq.com/docs/admin) — extend the dashboard
- [**Plugin development**](https://nextlyhq.com/docs/plugins) — build your own integrations

## Community

- [**GitHub Discussions**](https://github.com/nextlyhq/nextly/discussions) — questions, ideas, and show-and-tell
- [**Issues**](https://github.com/nextlyhq/nextly/issues) — bug reports and feature requests
- [**Contributing guide**](./CONTRIBUTING.md) — local setup, development workflow, code conventions
- [**Code of Conduct**](./CODE_OF_CONDUCT.md) — how we behave as a community

## Contributing

Contributions of every size are welcome — from typo fixes to new database adapters. Start with the [Contributing guide](./CONTRIBUTING.md) for local setup, the development workflow, and our PR/commit conventions. First-time contributors should look for issues tagged [`good first issue`](https://github.com/nextlyhq/nextly/labels/good%20first%20issue).

## Telemetry

The Nextly CLI (`create-nextly-app` and `nextly`) collects anonymous usage data to help us improve the tool. No personal information, project contents, file paths, or secrets are collected. Telemetry is automatically disabled in CI, Docker, production, and non-interactive shells.

See [nextlyhq.com/docs/telemetry](https://nextlyhq.com/docs/telemetry) for the full list of what is and is not collected, and for instructions on opting out (`nextly telemetry disable` or `NEXTLY_TELEMETRY_DISABLED=1`).

## License

[MIT](./LICENSE) — free to use, modify, and distribute. We hope you build something amazing.
