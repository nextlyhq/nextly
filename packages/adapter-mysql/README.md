# @nextlyhq/adapter-mysql

MySQL database adapter for Nextly. Built on `mysql2` with connection pooling and transactions.

<p align="center">
  <a href="https://www.npmjs.com/package/@nextlyhq/adapter-mysql"><img alt="npm" src="https://img.shields.io/npm/v/@nextlyhq/adapter-mysql?style=flat-square&label=npm&color=cb3837" /></a>
  <a href="https://github.com/nextlyhq/nextly/blob/main/LICENSE.md"><img alt="License" src="https://img.shields.io/github/license/nextlyhq/nextly?style=flat-square&color=blue" /></a>
  <a href="https://nextlyhq.com/docs"><img alt="Status" src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" /></a>
</p>

> [!IMPORTANT]
> Nextly is in alpha. APIs may change before 1.0. Pin exact versions in production.

## What it is

The MySQL adapter for Nextly. Use this if your database is MySQL or a MySQL-compatible cloud database (MariaDB, TiDB, Aurora MySQL, PlanetScale, Vitess work on best-effort).

> [!NOTE]
> **PostgreSQL is the recommended dialect for new Nextly projects.** MySQL works, but it lacks several features Nextly leans on natively in PostgreSQL. The adapter emulates or works around the gaps (see [Dialect notes](#dialect-notes) below). Choose MySQL only if you already standardize on it; choose [`@nextlyhq/adapter-postgres`](../adapter-postgres) for new builds.

## Installation

```bash
pnpm add @nextlyhq/adapter-mysql mysql2
```

## Quick usage

Nextly selects the adapter from your `.env` file. Install the package and set:

```bash
DB_DIALECT=mysql
DATABASE_URL=mysql://user:password@localhost:3306/mydb
```

That is it. Nextly's runtime instantiates the adapter on boot.

## Required environment variables

| Variable       | Required?   | Default                  | Notes                                   |
| -------------- | ----------- | ------------------------ | --------------------------------------- |
| `DATABASE_URL` | yes         | (none)                   | Standard `mysql://...` URL.             |
| `DB_DIALECT`   | recommended | (auto-detected from URL) | One of `postgresql`, `mysql`, `sqlite`. |

For SSL on managed providers (PlanetScale, Aurora MySQL), include the SSL params in the URL or set `MYSQL_SSL=true`.

## Programmatic usage (advanced)

For custom bootstrap such as test harnesses or scripts:

```ts
import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";

const adapter = createMySqlAdapter({
  url: process.env.DATABASE_URL!,
});

await adapter.connect();
```

Most users do not need this.

## Supported MySQL versions

- MySQL 8.0 or newer required
- MySQL-compatible variants (MariaDB, TiDB, Aurora MySQL, PlanetScale, Vitess) work on best-effort. The adapter detects the variant at connect time and warns when behavior may diverge.

## Dialect notes

MySQL lacks a few features Nextly uses natively in PostgreSQL. The adapter emulates or works around them:

- **`RETURNING` clause:** emulated with an extra `SELECT` after writes.
- **`ILIKE`:** emulated as `LOWER(...) LIKE LOWER(...)`.
- **Savepoints:** disabled by the adapter.
- **`JSONB`:** not available; `JSON` columns are used instead.

## Main exports

- `MySqlAdapter`: the adapter class
- `createMySqlAdapter`: factory for programmatic use
- `isMySqlAdapter`: type guard
- Type exports: `MySqlAdapterConfig`

## Compatibility

| Tool     | Version |
| -------- | ------- |
| Node.js  | 20+     |
| `mysql2` | 3+      |
| `nextly` | 0.0.x   |

## Documentation

- [**MySQL adapter docs**](https://nextlyhq.com/docs/database/mysql)
- [**Database support and version policy**](https://nextlyhq.com/docs/database/support)

## Related packages

- [`@nextlyhq/adapter-postgres`](../adapter-postgres): recommended for new projects
- [`@nextlyhq/adapter-sqlite`](../adapter-sqlite)

## License

[MIT](../../LICENSE.md)
