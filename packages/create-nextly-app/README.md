# create-nextly-app

The official CLI for scaffolding a new Nextly CMS project.

<p align="center">
  <a href="https://www.npmjs.com/package/create-nextly-app"><img alt="npm" src="https://img.shields.io/npm/v/create-nextly-app?style=flat-square&label=npm&color=cb3837" /></a>
  <a href="https://github.com/nextlyhq/nextly/blob/main/LICENSE.md"><img alt="License" src="https://img.shields.io/github/license/nextlyhq/nextly?style=flat-square&color=blue" /></a>
  <a href="https://nextlyhq.com/docs"><img alt="Status" src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" /></a>
</p>

> [!IMPORTANT]
> Nextly is in alpha. APIs may change before 1.0. Pin exact versions in production.

## Quickstart

```bash
# pnpm
pnpm create nextly-app my-app

# npm
npx create-nextly-app@latest my-app

# yarn
yarn create nextly-app my-app

# bun
bun create nextly-app my-app
```

The CLI walks you through:

1. Project name (or `.` to install in the current directory)
2. Template (`blank` or `blog`)
3. Schema approach (`code-first` or `visual`), only for templates that support both
4. Database (`sqlite`, `postgresql`, or `mysql`)
5. Database connection string (skipped for SQLite)

After scaffolding, `pnpm dev` runs the project. Visit [http://localhost:3000/admin/setup](http://localhost:3000/admin/setup) to create the first admin user.

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
pnpm create nextly-app my-blog --template blog --approach code-first

# Blank project with PostgreSQL
pnpm create nextly-app my-app --template blank --database postgresql

# Skip prompts entirely (defaults: blank, SQLite, local storage)
pnpm create nextly-app my-app -y
```

## CLI flags

| Flag                | Short | Description                                                  | Default            |
| ------------------- | ----- | ------------------------------------------------------------ | ------------------ |
| `--yes`             | `-y`  | Skip prompts and use defaults (blank, SQLite, local storage) | `false`            |
| `--template <name>` | `-t`  | Project template: `blank`, `blog`                            | Interactive prompt |
| `--approach <type>` | `-a`  | Schema approach: `code-first`, `visual`                      | Interactive prompt |
| `--database <db>`   | `-d`  | Database: `sqlite`, `postgresql`, `mysql`                    | Interactive prompt |
| `--branch <branch>` | `-b`  | Git branch for template download                             | `main`             |
| `--version`         | `-V`  | Print the CLI version                                        |                    |
| `--help`            | `-h`  | Show help text                                               |                    |

Run `pnpm create nextly-app --help` for the inline reference.

<details>
<summary><strong>Contributor flags</strong> (development only)</summary>

These flags exist for Nextly maintainers and contributors working on the framework locally. They are not intended for end-user projects and are not covered by the alpha-stability promise.

| Flag                      | Description                                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--local-template <path>` | Read templates from a local filesystem path instead of downloading them from GitHub.                                                                |
| `--skip-install`          | Skip the dependency-installation step. Useful when testing the scaffolder against unpublished package versions.                                     |
| `--use-yalc`              | Install Nextly packages from a local [yalc](https://github.com/wclr/yalc) store instead of npm. Used for end-to-end testing of unpublished changes. |

See [CONTRIBUTING.md](https://github.com/nextlyhq/nextly/blob/main/CONTRIBUTING.md) for the local development workflow.

</details>

## Documentation

- [**Quick start**](https://nextlyhq.com/docs/getting-started/quick-start)
- [**Installation**](https://nextlyhq.com/docs/getting-started/installation)
- [**Project structure**](https://nextlyhq.com/docs/getting-started/project-structure)
- [**Templates**](https://nextlyhq.com/docs/templates)

## See also

- [`nextly`](https://github.com/nextlyhq/nextly/tree/main/packages/nextly): the core framework this CLI scaffolds.
- The [Nextly monorepo](https://github.com/nextlyhq/nextly) for the full ecosystem of packages.

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
