# @revnixhq/adapter-drizzle

Shared Drizzle ORM adapter logic for Nextly database adapters. Provides the base class, types, query builder, and migration utilities used by every dialect adapter.

<p align="center">
  <a href="https://www.npmjs.com/package/@revnixhq/adapter-drizzle"><img alt="npm" src="https://img.shields.io/npm/v/@revnixhq/adapter-drizzle?style=flat-square&label=npm&color=cb3837" /></a>
  <a href="https://github.com/nextlyhq/nextly/blob/main/LICENSE.md"><img alt="License" src="https://img.shields.io/github/license/nextlyhq/nextly?style=flat-square&color=blue" /></a>
  <a href="https://nextlyhq.com/docs"><img alt="Status" src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" /></a>
</p>

> [!IMPORTANT]
> Nextly is in alpha. APIs may change before 1.0. Pin exact versions in production.

> **Most users do not install this directly.** Install [`@revnixhq/adapter-postgres`](../adapter-postgres), [`@revnixhq/adapter-mysql`](../adapter-mysql), or [`@revnixhq/adapter-sqlite`](../adapter-sqlite) instead.

## What it is (for adapter developers)

This package is the foundation of every Nextly database adapter. The dialect packages (Postgres, MySQL, SQLite) extend `DrizzleAdapter` and override only the dialect-specific bits. If you want to add support for a database that does not yet have an adapter (Turso, libSQL, MongoDB), you start here.

## Installation

```bash
pnpm add @revnixhq/adapter-drizzle drizzle-orm
```

## Building a custom adapter

Extend the `DrizzleAdapter` base class. Minimal stub:

```ts
import { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import type { DatabaseAdapter } from "@revnixhq/nextly";

export class MyAdapter extends DrizzleAdapter implements DatabaseAdapter {
  protected dialect = "myadapter" as const;

  async connect() {
    /* open the underlying client */
  }
  async disconnect() {
    /* close it */
  }
  async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    /* dialect-specific transaction handling */
    throw new Error("Not implemented");
  }
}

export function createMyAdapter(config: MyAdapterConfig) {
  return new MyAdapter(config);
}
```

The base class provides default CRUD, query building, migration running, transaction lifecycle, and error classification. You override only what differs.

Architectural deep dives (transaction model, savepoint policy, retry on serialization failures, dialect capability reporting) live in the [Building a custom database adapter](https://nextlyhq.com/docs/database/custom-adapters) docs page.

## Main exports

- `DrizzleAdapter` – base class
- `QueryBuilder` – fluent immutable query builder
- `MigrationRunner` – up/down migration utilities
- Type exports: `DatabaseAdapter`, `Transaction`, `RawQueryResult`, `DialectCapabilities`

## Compatibility

- Node.js 18+
- `drizzle-orm` 0.30+
- `@revnixhq/nextly` 0.0.x

## Documentation

**[Custom database adapters →](https://nextlyhq.com/docs/database/custom-adapters)**

## Related packages

- [`@revnixhq/adapter-postgres`](../adapter-postgres)
- [`@revnixhq/adapter-mysql`](../adapter-mysql)
- [`@revnixhq/adapter-sqlite`](../adapter-sqlite)

## License

[MIT](../../LICENSE.md)
