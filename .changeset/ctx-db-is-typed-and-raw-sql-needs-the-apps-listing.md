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

`ctx.db` is typed and owner-checked, raw SQL needs the app's consent, and
plugin code no longer reaches core's live handles through `ctx.config`,
`ctx.services` or a `setup` transformer.

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
  itself. A listed name that matches no configured plugin logs a warning at
  boot.

- **The raw-SQL grant is judged on the plugins as the app configured them.**
  - The plugins are recorded before any `setup` transformer runs, and the
    transformed list is judged against that record.
  - A plugin that holds `capabilities.db.rawSql` only because a transformer
    gave it (adding the plugin, renaming a plugin onto a name no configured
    plugin declaring it held, or setting the flag on a plugin whose manifest
    does not declare it) refuses the boot with `PLUGIN_RESOLUTION_ERROR`
    (`capability-added-by-setup`).
  - A plugin that declares `rawSql` under a configured name whose lifecycle
    functions or `contributes` a transformer replaced (including dropping the
    configured plugin and renaming another onto its name) refuses with
    `plugin-code-replaced-by-setup`, naming the plugin and the changed path.
  - The grant is decided once, when the boot resolves the plugin list. Every
    plugin context, the auth router's included, reads that decision, so
    turning `capabilities.db.rawSql` on after the boot grants nothing. The
    exported `createPluginContext` takes the grants as a fourth argument and
    grants nothing without them.
- **A `setup` transformer receives copies of settings, not live handles.** It
  receives copies of the plugin definitions and of the plain settings, with
  `db.rawSqlPlugins` frozen. `adapter`, `logger`, `hookRegistry`,
  `passwordHasher`, `rateLimit`, `storagePlugins` (the CLI's `storage`),
  `imageProcessor` and `pluginConsent` are absent from its input, and a value
  it returns under those keys, or under any other key it was not handed, is
  ignored: the app's own value is kept. Editing a definition in place no
  longer changes the app's own plugin objects. `PluginDefinition.setup`'s
  type is unchanged, so typed transformers still compile; the withheld keys
  are simply absent at runtime.
- **`ctx.config` is a frozen copy of plain configuration.** Its type is the
  new `PluginConfig`, in place of `Readonly<NextlyServiceConfig>`.
  - Every plain object and array in it is a copy frozen all the way down, so
    writing a nested value throws in strict-mode code rather than reaching
    the configuration core reads. Functions and class instances are kept by
    reference.
  - Removed: `adapter`, `db`, `pluginConsent`, `storagePlugins`,
    `imageProcessor`, `logger` (use `ctx.logger`), `hookRegistry` (use
    `ctx.hooks`), `passwordHasher`, `rateLimit`, and `email.providerConfig`
    (the provider's credentials).
  - `ctx.config.plugins` lists `PluginSummary` entries (`name`, `version`,
    `enabled`, `capabilities`, `contributes.declarations`), not definitions.
- **`ctx.services` hands out facades.**
  - `users`, `media`, `email`, `versions` and `collections` are frozen
    facades of the methods meant for plugins. A service's `adapter`, Drizzle
    handle, sub-services and logger are no longer reachable, and
    `collections.registerDynamicSchemas` and `invalidateSchemaForSlug` are
    gone.
  - `collections.withTransaction` hands its work an opaque
    `PluginCollectionTransaction` token, which the `*InTransaction` methods
    accept, instead of the adapter's transaction context; any other value is
    rejected with `VALIDATION_ERROR` (`plugin-transaction-token-unknown`).
    This changes the `@public` `PluginCollectionService` type.
  - The `*InTransaction` methods take `ServiceOpts` as their last argument,
    as `createEntry`, `updateEntry` and `deleteEntry` do, not the service's
    request context. A context naming `overrideAccess`, or a `user` carrying
    its own roles, was handed to the access check as written; now a `user`
    is judged with the roles the other methods resolve for it, and an
    `overrideAccess` key is not read. `{ user: ctx.user }` and `{}` keep
    their meaning (that caller, and `system`). `deleteEntryInTransaction`
    no longer takes an `actor`.
- **`ctx.db.transaction` does not nest.** `tx` is the typed surface bound to
  the transaction's connection, and its type has no `transaction`. Called
  anyway, it rejects with `INVALID_INPUT` (`nested-plugin-transaction`)
  instead of opening a second transaction on another connection. With
  `rawSql` listed, `ctx.db.raw.transaction`'s `tx` is the live handle and its
  `transaction` nests as a savepoint.

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
- New experimental types, from `nextly` and `@nextlyhq/plugin-sdk`:
  `PluginConfig`, `PluginSummary`, `PluginEmailSettings`, `PluginUserService`,
  `PluginMediaService`, `PluginEmailService`, `PluginVersionsService` and
  `PluginCollectionTransaction`.
- `createTestNextly` takes a `pluginConsent` option (`@experimental`), the
  test's counterpart of `db.rawSqlPlugins`, and its refusal of a plugin that
  declares `rawSql` names the option and the value to pass.

Full details: `docs/plugins/services.mdx` and `docs/plugins/security.mdx`.
