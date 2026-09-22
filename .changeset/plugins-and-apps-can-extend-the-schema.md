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

Plugins and apps can extend the database schema.

A plugin declares tables with a dialect-neutral DSL, or through hooks that run
in dependency order and see every table already declared. What it declares is
typed without a codegen step, reached through an owner-checked `ctx.db`, and
carried to production by migrations the plugin ships itself.

**Collection `indexes` now reach the database.** They have been validated and
then discarded since the option was introduced, so an app that declared a
compound index has been running without one. The next dev push or
`migrate:create` will add it — and a unique index over columns that already
hold duplicate rows will fail to build until the duplicates are resolved:

```sql
SELECT country, city, COUNT(*)
FROM dc_places
GROUP BY country, city
HAVING COUNT(*) > 1;
```

**Pending migrations now run before plugins initialise.** They used to run
after, so a plugin's `init()` hook queried a database whose migrations had not
been applied. On an upgraded database that meant writing to a column that did
not exist yet.

What the schema model cannot carry into migrations and drift detection is
REFUSED rather than lost: partial and expression indexes on dialects without
them, check constraints, foreign keys and enums where the diff cannot see
them, and anything an app's `afterDrizzle` hook returns that would not survive
the round trip. A constraint that exists on one machine and no deployment is
worse than one that does not exist at all.

Ownership is recorded per table and per element, so no path drops a table — or
a column — on behalf of an owner that does not own it. A table with no owner
record is never dropped by anything.

`nextly plugin:install` and `plugin:uninstall` manage a plugin's schema, with
`--keep-data`, a refusal while another plugin depends on it, and a refusal
when a migration cannot be undone.

Full details: `docs/plugins/schema.mdx`, `docs/database/extending-the-schema.mdx`
and `docs/guides/production-migrations.mdx`.
