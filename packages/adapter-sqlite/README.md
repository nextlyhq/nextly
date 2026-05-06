# @revnixhq/adapter-sqlite

SQLite database adapter for Nextly. Built on `better-sqlite3` for synchronous file-based persistence.

<p align="center">
  <a href="https://www.npmjs.com/package/@revnixhq/adapter-sqlite"><img alt="npm" src="https://img.shields.io/npm/v/@revnixhq/adapter-sqlite?style=flat-square&label=npm&color=cb3837" /></a>
  <a href="https://github.com/nextlyhq/nextly/blob/main/LICENSE.md"><img alt="License" src="https://img.shields.io/github/license/nextlyhq/nextly?style=flat-square&color=blue" /></a>
  <a href="https://nextlyhq.com/docs"><img alt="Status" src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" /></a>
</p>

> [!IMPORTANT]
> Nextly is in alpha. APIs may change before 1.0. Pin exact versions in production.

> [!WARNING]
> **SQLite is for local demos only.** Single-writer, file-based, no SSL. Not recommended for serious local development. Run PostgreSQL in Docker (`docker compose up -d postgres`) instead.

## What it is

The SQLite adapter for Nextly. Use this for one-off local demos or quick experiments where setting up a database server would be friction.

## Installation

```bash
pnpm add @revnixhq/adapter-sqlite better-sqlite3
```

## Quick usage

Nextly selects the adapter from your `.env` file. Install the package and set:

```bash
DB_DIALECT=sqlite
DATABASE_URL=file:./data/nextly.db
```

The path can be relative (resolved against the project root) or absolute. The directory must exist.

## Required environment variables

| Variable       | Required?   | Default                  | Notes                                          |
| -------------- | ----------- | ------------------------ | ---------------------------------------------- |
| `DATABASE_URL` | yes         | (none)                   | `file:./path/to/db.sqlite` or absolute path.   |
| `DB_DIALECT`   | recommended | (auto-detected from URL) | Set explicitly to silence the warning at boot. |

## Programmatic usage (advanced)

For test harnesses or scripts:

```ts
import { createSqliteAdapter } from "@revnixhq/adapter-sqlite";

const adapter = createSqliteAdapter({
  url: process.env.DATABASE_URL!,
});

await adapter.connect();
```

Most users do not need this.

## Supported SQLite versions

- SQLite 3.38 or newer required (bundled with `better-sqlite3`)

## Dialect notes

- **Single writer.** SQLite serializes writes; concurrent transactions queue. Fine for one user, painful for production traffic.
- **No SSL / TLS.** Not applicable to a local file.
- **Limited types.** No native arrays, no JSONB; JSON is stored as TEXT. ILIKE is emulated as `LOWER(...) LIKE LOWER(...)`.
- **Savepoints.** Supported.
- **`RETURNING` clause.** Supported (SQLite 3.35+).

## Main exports

- `SqliteAdapter` – the adapter class
- `createSqliteAdapter` – factory for programmatic use
- `isSqliteAdapter` – type guard
- Type exports: `SqliteAdapterConfig`

## Compatibility

- Node.js 18+
- `better-sqlite3` 11+
- `@revnixhq/nextly` 0.0.x

## Documentation

**[SQLite adapter docs →](https://nextlyhq.com/docs/database/sqlite)**

## Related packages

- [`@revnixhq/adapter-postgres`](../adapter-postgres) – recommended for production
- [`@revnixhq/adapter-mysql`](../adapter-mysql)
- [`@revnixhq/adapter-drizzle`](../adapter-drizzle) – the base class

## License

[MIT](../../LICENSE.md)
