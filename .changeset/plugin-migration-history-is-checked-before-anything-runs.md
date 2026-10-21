---
"create-nextly-app": patch
"nextly": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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

`nextly migrate` now checks every plugin's migration history before it changes
anything, the core tables included, and refuses — naming the plugin and the
migration — when:

- a plugin lists its migrations in an order other than the order of their
  names, which is the order they run in (also refused when the configuration
  loads);
- a migration the database records as applied has been edited, removed or
  renamed;
- a migration that has not run is ordered before one that has.

Lists written by `nextly migrate:create --plugin` are already in name order,
so only a list edited by hand is affected: list the migrations in name order,
restore the applied migration, or give a new migration a name that sorts after
the applied ones. A migration rolled back by hand from the middle of a plugin's
history is refused the same way until the migrations after it are rolled back,
or it is recorded applied with `nextly migrate:resolve --applied`.

A plugin migration whose run was stopped after its statements committed — on
MySQL, which commits schema statements as they run, or one marked to run
outside a transaction — is now recorded as applied on the next run when its
statements are exactly the schema change `nextly migrate:create --plugin`
writes for it and the database stands at its result.
Before, it was refused until `nextly migrate:resolve --failed-cleanup`. A
migration that also changes rows, whose result is its starting point, or
whose statements were written or edited by hand, is still refused, with the
same advice.

A drift refusal now names the column, check or foreign key it found different,
where it used to say only the kind of change.
