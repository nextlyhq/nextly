# @revnixhq/create-nextly-app

The official CLI for scaffolding a new Nextly CMS project or adding Nextly to an existing Next.js app.

<p align="center">
  <a href="https://www.npmjs.com/package/@revnixhq/create-nextly-app"><img alt="npm" src="https://img.shields.io/npm/v/@revnixhq/create-nextly-app?style=flat-square&label=npm&color=cb3837" /></a>
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

```bash
pnpm create-nextly-app@latest
```

The CLI walks you through:

1. Project name (or `.` for the current directory)
2. Template (`blank` or `blog`)
3. Schema approach (`code-first` or `visual`)
4. Database (`sqlite`, `postgresql`, or `mysql`)

After scaffolding, `pnpm dev` runs the project; visit `http://localhost:3000/admin/setup` to create the first admin user.

## Templates

| Template  | Description                                                                         |
| --------- | ----------------------------------------------------------------------------------- |
| **blank** | Empty config. Define your own collections from scratch.                             |
| **blog**  | Posts, categories, tags, frontend pages, RSS, sitemap, and admin-editable homepage. |

More templates (portfolio, e-commerce, SaaS admin) are planned.

## Schema approaches

| Approach       | Description                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| **code-first** | Schemas live in `nextly.config.ts` plus files under `src/collections/`. Type-safe and version-controlled. |
| **visual**     | Schemas are defined in the Admin UI's Schema Builder. Stored in the database.                             |

The two approaches are not mutually exclusive: a code-first project can add UI-defined collections later, and vice versa.

## Non-interactive usage

```bash
# Blog with code-first approach
pnpm create-nextly-app@latest my-blog --template blog --approach code-first

# Blank project with PostgreSQL
pnpm create-nextly-app@latest my-app --template blank --database postgresql

# Skip prompts entirely (defaults: blank, SQLite)
pnpm create-nextly-app@latest my-app -y
```

## CLI flags

| Flag                      | Short | Description                                        | Default            |
| ------------------------- | ----- | -------------------------------------------------- | ------------------ |
| `--yes`                   | `-y`  | Skip prompts; use defaults (blank, SQLite)         |                    |
| `--template <name>`       | `-t`  | Template (`blank`, `blog`)                         | Interactive prompt |
| `--approach <type>`       | `-a`  | Schema approach (`code-first`, `visual`)           | Interactive prompt |
| `--database <db>`         | `-d`  | Database (`sqlite`, `postgresql`, `mysql`)         | Interactive prompt |
| `--branch <branch>`       | `-b`  | Git branch for template download                   | `main`             |
| `--local-template <path>` |       | Local templates directory (dev only)               |                    |
| `--skip-install`          |       | Skip dependency install (for local testing)        |                    |
| `--use-yalc`              |       | Use yalc for local package installation (dev only) |                    |

Run `pnpm create-nextly-app --help` for the full list and inline help.

## Documentation

- [**Quick start**](https://nextlyhq.com/docs/getting-started/quick-start)
- [**Installation**](https://nextlyhq.com/docs/getting-started/installation)
- [**Project structure**](https://nextlyhq.com/docs/getting-started/project-structure)
- [**Templates**](https://nextlyhq.com/docs/templates)

## Community

- [**GitHub Discussions**](https://github.com/nextlyhq/nextly/discussions) for questions, ideas, and show-and-tell
- [**Issues**](https://github.com/nextlyhq/nextly/issues) for bug reports and feature requests
- [**Discord**](https://discord.gg/hJUg9AZMn) for real-time chat with the team and other users
- [**Contributing guide**](https://github.com/nextlyhq/nextly/blob/main/CONTRIBUTING.md) for local setup, the dev workflow, and PR conventions

## Contributing

Contributions of every size are welcome. Start with the [Contributing guide](https://github.com/nextlyhq/nextly/blob/main/CONTRIBUTING.md) for local setup and PR conventions.

## Telemetry

The Nextly CLI (`create-nextly-app` and `nextly`) collects anonymous usage data to help us improve the tool. No personal information, project contents, file paths, or secrets are collected. Telemetry is automatically disabled in CI, Docker, production, and non-interactive shells.

See [nextlyhq.com/docs/telemetry](https://nextlyhq.com/docs/telemetry) for the full list of what is and is not collected, and for instructions on opting out (`nextly telemetry disable` or `NEXTLY_TELEMETRY_DISABLED=1`).

## License

[MIT](https://github.com/nextlyhq/nextly/blob/main/LICENSE.md). Free to use, modify, and distribute.
