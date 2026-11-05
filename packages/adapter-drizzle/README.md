# @nextlyhq/adapter-drizzle

Internal Drizzle ORM utilities for Nextly's database adapters.

<p align="center">
  <a href="https://www.npmjs.com/package/@nextlyhq/adapter-drizzle"><img alt="npm" src="https://img.shields.io/npm/v/@nextlyhq%2Fadapter-drizzle?style=flat-square&label=npm&color=cb3837" /></a>
  <a href="https://github.com/nextlyhq/nextly/blob/main/LICENSE.md"><img alt="License" src="https://img.shields.io/github/license/nextlyhq/nextly?style=flat-square&color=blue" /></a>
  <a href="https://nextlyhq.com/docs"><img alt="Status" src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" /></a>
</p>

> [!IMPORTANT]
> Nextly is in alpha. APIs may change before 1.0. Pin exact versions in production.

This package is part of Nextly's internals. It is installed automatically as a dependency of [`nextly`](../nextly). Choose [`@nextlyhq/adapter-postgres`](../adapter-postgres), [`@nextlyhq/adapter-mysql`](../adapter-mysql), or [`@nextlyhq/adapter-sqlite`](../adapter-sqlite) for your project.

## Install

You do not install this directly. It arrives as a dependency of [`nextly`](../nextly)
and of each database adapter. Install the adapter for your database instead:

```bash
pnpm add @nextlyhq/adapter-postgres pg
```

## Related packages

- [`@nextlyhq/adapter-postgres`](../adapter-postgres) — recommended for production
- [`@nextlyhq/adapter-mysql`](../adapter-mysql)
- [`@nextlyhq/adapter-sqlite`](../adapter-sqlite) — local demos

## License

[MIT](../../LICENSE.md)

## A SQLite adapter of your own

Case-insensitive matches (`contains`, `ICONTAINS`, `ILIKE`) call a Nextly SQL function, `nextly_fold_case`, on SQLite, because SQLite's own `lower()` folds ASCII letters only. The official SQLite adapter registers it on every connection it opens. An adapter of your own that runs on SQLite must register it on each of its connections before Nextly's statements run there:

```ts
import { registerSqliteFoldCase } from "@nextlyhq/adapter-drizzle/text-match";

registerSqliteFoldCase(db); // a better-sqlite3 Database, or anything with the same `function` method
```

Without it, those statements fail with `no such function: nextly_fold_case` rather than matching fewer rows than the other databases do.
