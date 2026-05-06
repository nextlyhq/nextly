# @revnixhq/adapter-postgres

PostgreSQL database adapter for Nextly. Built on `pg` (node-postgres) with connection pooling, transactions, JSONB, and array support.

<p align="center">
  <a href="https://www.npmjs.com/package/@revnixhq/adapter-postgres"><img alt="npm" src="https://img.shields.io/npm/v/@revnixhq/adapter-postgres?style=flat-square&label=npm&color=cb3837" /></a>
  <a href="https://github.com/nextlyhq/nextly/blob/main/LICENSE.md"><img alt="License" src="https://img.shields.io/github/license/nextlyhq/nextly?style=flat-square&color=blue" /></a>
  <a href="https://nextlyhq.com/docs"><img alt="Status" src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" /></a>
</p>

> [!IMPORTANT]
> Nextly is in alpha. APIs may change before 1.0. Pin exact versions in production.

## What it is

The PostgreSQL adapter for Nextly. Use this if your database is PostgreSQL or any PG-compatible cloud (Neon, Supabase, RDS, Aurora PG, Crunchy Bridge).

PostgreSQL is the recommended production database for Nextly: it has the full feature set (JSONB, arrays, native ILIKE, savepoints, RETURNING, full-text search via `tsvector`).

## Installation

```bash
pnpm add @revnixhq/adapter-postgres pg
pnpm add -D @types/pg
```

## Quick usage

Nextly selects the adapter from your `.env` file. Install the package and set:

```bash
DB_DIALECT=postgresql
DATABASE_URL=postgres://user:password@localhost:5432/mydb
```

That's it. Nextly's runtime instantiates the adapter on boot.

## Required environment variables

| Variable       | Required?   | Default                  | Notes                                   |
| -------------- | ----------- | ------------------------ | --------------------------------------- |
| `DATABASE_URL` | yes         | (none)                   | Standard `postgres://...` URL.          |
| `DB_DIALECT`   | recommended | (auto-detected from URL) | One of `postgresql`, `mysql`, `sqlite`. |

For SSL on managed providers (Neon, Supabase, RDS), append `?sslmode=require` to the URL or set `PGSSLMODE=require`.

## Programmatic usage (advanced)

For custom bootstrap (test harnesses, scripts), import the factory:

```ts
import { createPostgresAdapter } from "@revnixhq/adapter-postgres";

const adapter = createPostgresAdapter({
  url: process.env.DATABASE_URL!,
});

await adapter.connect();
```

Most users do not need this. The framework's runtime does it automatically.

## Supported PostgreSQL versions

- PostgreSQL 15.0 or newer required
- Tested against PostgreSQL 15, 16, 17
- Cloud providers: Neon, Supabase, RDS, Aurora PG, Crunchy Bridge

## Main exports

- `PostgresAdapter` – the adapter class
- `createPostgresAdapter` – factory for programmatic use
- `isPostgresAdapter` – type guard
- Type exports: `PostgresAdapterConfig`

## Compatibility

- Node.js 18+
- `pg` 8.10+
- `@revnixhq/nextly` 0.0.x

## Documentation

**[PostgreSQL adapter docs →](https://nextlyhq.com/docs/database/postgres)**

## Related packages

- [`@revnixhq/adapter-mysql`](../adapter-mysql)
- [`@revnixhq/adapter-sqlite`](../adapter-sqlite)
- [`@revnixhq/adapter-drizzle`](../adapter-drizzle) – the base class

## License

[MIT](../../LICENSE.md)
