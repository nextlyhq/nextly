---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

`ctx.db` is typed and owner-checked, and raw SQL needs the app's consent.

## Breaking changes

- **`ctx.db` is no longer a Drizzle handle.** It is the owner-checked surface
  over the tables a plugin declared, its dependencies' tables and the columns
  it contributed, the same on every dialect. The four verbs it shares with
  Drizzle take different arguments: `ctx.db.select(myTable)` where you wrote
  `ctx.db.select().from(myTable)`. A call written against the old shape is
  refused by name, saying what changed and where the old handle went.
- **The old handle is `ctx.db.raw`, and it is the restricted builder.** It has
  Drizzle's `select`, `insert`, `update` and `delete` plus `transaction`, with
  no owner check, and no `execute`, `run` or relational `query`. Inside its
  `transaction`, `tx` is the same builder without a nested `transaction`. The
  smallest migration is one property deeper:

  ```ts
  // before
  await ctx.db.select().from(rows).where(eq(rows.id, id));
  // after: the restricted builder
  await ctx.db.raw.select().from(rows).where(eq(rows.id, id));
  // or owner-checked and portable across all three dialects
  await ctx.db
    .select(rows)
    .where(eq(ctx.db.table(rows).id, id))
    .first();
  ```

- **Raw SQL needs the app to list the plugin.** `ctx.db.raw` is the live
  Drizzle instance, `execute` and `run` included, only for a plugin that
  declares `capabilities.db.rawSql` AND that the app lists in
  `nextly.config.ts`:

  ```ts
  db: {
    rawSqlPlugins: ["@acme/nextly-reports"];
  }
  ```

  Declaring `rawSql` used to be enough, and the live instance was `ctx.db`
  itself. An enabled plugin that declares it without being listed now stops
  the boot and every CLI command that loads plugins with
  `PLUGIN_RESOLUTION_ERROR` (`logContext.reason` is `capability-not-listed`);
  the message names the line to add. The list is read from the config as the
  app wrote it, before any plugin's `setup` runs, so a plugin cannot add
  itself. A listed name that matches no configured plugin logs a warning.

- **`ctx.db.transaction` does not nest.** `tx` is the typed surface bound to
  the transaction's connection; calling `transaction` on it is refused. With
  `rawSql` listed, `ctx.db.raw.transaction`'s `tx` is the live handle and its
  `transaction` nests as a savepoint.
- **`ctx.config` carries configuration values only.** It no longer includes
  the live database `adapter` or the raw-SQL consent data. Reach the database
  through `ctx.db`, or through `ctx.db.raw` with `rawSql` declared and listed.

This corrects the earlier release note that said a plugin declaring `rawSql`
gets the live Drizzle instance at `ctx.db`: the live instance is at
`ctx.db.raw`, and only once the app lists the plugin in `db.rawSqlPlugins`.

## Added

- `ctx.dialect` (`@experimental`) says which database the installation runs
  on, for the cases a plugin cannot be dialect-blind, such as reading a
  driver's error.
- `ctx.db.transaction` runs through the adapter's transaction on every
  dialect; what the work throws reaches the plugin as thrown, and on SQLite a
  core service called inside joins it as a savepoint whose after-commit
  effects wait for the commit.
- `ctx.db.query.<table>.findMany({ with })` runs relational queries over the
  tables `ctx.db` may reach.

Full details: `docs/plugins/services.mdx` and `docs/plugins/security.mdx`.
