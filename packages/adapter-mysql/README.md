# @revnixhq/adapter-mysql

MySQL database adapter for Nextly. Built on `mysql2` with connection pooling and transactions.

<p align="center">
  <a href="https://www.npmjs.com/package/@revnixhq/adapter-mysql"><img alt="npm" src="https://img.shields.io/npm/v/@revnixhq/adapter-mysql?style=flat-square&label=npm&color=cb3837" /></a>
  <a href="https://github.com/nextlyhq/nextly/blob/main/LICENSE.md"><img alt="License" src="https://img.shields.io/github/license/nextlyhq/nextly?style=flat-square&color=blue" /></a>
  <a href="https://nextlyhq.com/docs"><img alt="Status" src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" /></a>
</p>

> [!IMPORTANT]
> Nextly is in alpha. APIs may change before 1.0. Pin exact versions in production.

## What it is

The MySQL adapter for Nextly. Use this if your database is MySQL or a MySQL-compatible cloud database (MariaDB, TiDB, Aurora MySQL, PlanetScale, Vitess work on best-effort).

If you can pick a database, prefer PostgreSQL for new Nextly projects: it has the full feature set including JSONB, arrays, savepoints, and `RETURNING`. MySQL emulates some of these and disables others. See the [feature comparison](https://nextlyhq.com/docs/database#feature-comparison).

## Installation

```bash
pnpm add @revnixhq/adapter-mysql mysql2
```

## Quick usage

Nextly selects the adapter from your `.env` file. Install the package and set:

```bash
DB_DIALECT=mysql
DATABASE_URL=mysql://user:password@localhost:3306/mydb
```

That's it. Nextly's runtime instantiates the adapter on boot.

## Required environment variables

| Variable       | Required?   | Default                  | Notes                                   |
| -------------- | ----------- | ------------------------ | --------------------------------------- |
| `DATABASE_URL` | yes         | (none)                   | Standard `mysql://...` URL.             |
| `DB_DIALECT`   | recommended | (auto-detected from URL) | One of `postgresql`, `mysql`, `sqlite`. |

For SSL on managed providers (PlanetScale, Aurora MySQL), include the SSL params in the URL or set `MYSQL_SSL=true`.

## Programmatic usage (advanced)

For custom bootstrap (test harnesses, scripts):

```ts
import { createMySqlAdapter } from "@revnixhq/adapter-mysql";

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

MySQL lacks a few features Nextly leans on in PostgreSQL. The adapter emulates or works around them:

- `RETURNING` clause: emulated with an extra `SELECT` after writes.
- `ILIKE`: emulated as `LOWER(...) LIKE LOWER(...)`.
- Savepoints: disabled by the adapter.
- `JSONB`: not available; `JSON` columns are used instead.

## Main exports

- `MySqlAdapter` – the adapter class
- `createMySqlAdapter` – factory for programmatic use
- `isMySqlAdapter` – type guard
- Type exports: `MySqlAdapterConfig`

## Compatibility

- Node.js 18+
- `mysql2` 3+
- `@revnixhq/nextly` 0.0.x

## Documentation

**[MySQL adapter docs →](https://nextlyhq.com/docs/database/mysql)**

## Related packages

- [`@revnixhq/adapter-postgres`](../adapter-postgres)
- [`@revnixhq/adapter-sqlite`](../adapter-sqlite)
- [`@revnixhq/adapter-drizzle`](../adapter-drizzle) – the base class

## License

[MIT](../../LICENSE.md)
