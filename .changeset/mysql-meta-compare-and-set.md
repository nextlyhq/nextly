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

**On MySQL, turning localization off now brings the content back.** On MySQL,
`nextly_meta`'s compare-and-set, and every statement guarded on one of its
rows, never matched a stored value: the column is native JSON and the stored
text was compared encoded twice. Postgres and SQLite were not affected.

What a MySQL install saw, in every release since localization transitions were
recorded (2026-07-31):

- **Turning localization off on an entity copied nothing back onto its main
  table**, during `db:sync`, dev reloads and `nextly migrate`'s companion
  pass. The site went back to the values the entity had before it was
  localized, and edits made while it was localized looked lost. They were not:
  they are intact in the entity's translation table (`dc_<slug>_locales` for a
  collection), which is left in place.
- Re-enabling localization after a disable did not refresh the translation
  table, so edits made while it was off stayed hidden.
- A first enable copied its content, but every later pass reported that the
  transition was held by another process. Writing translations was not blocked.

**Before you start the upgraded version, save any edit made directly to an
affected entity's main table since you turned its localization off.** The first
`nextly db:sync`, dev-server start or `nextly migrate` after upgrading restores
the translation table's values onto the main table, replacing those edits. To
list the rows where the two differ, run this for each entity whose localization
you turned off, with its slug, its default locale and one comparison per
translated field:

```sql
SELECT m.id, m.updated_at, m.title AS on_main, l.title AS in_translations
FROM dc_<slug> AS m
JOIN dc_<slug>_locales AS l ON l._parent = m.id AND l._locale = '<default locale>'
WHERE NOT (BINARY m.title <=> BINARY l.title);
```

`BINARY` on both sides makes the comparison exact and keeps it null-safe:
under MySQL's default collation, `<=>` alone takes `Foo` and `foo` for the
same value, so an edit that changed only letter case or accents would not be
listed. For an entity defined with `timestamps: false`, leave out
`m.updated_at`: it has no such column.

A row whose `updated_at` is later than the disable was edited on the main
table since, and the upgrade replaces it with `in_translations`. Every other
listed row is an edit made while the entity was localized, which the upgrade
brings back. `updated_at` moves only with saves made through Nextly: a row
changed outside it (from a SQL client or a script) can keep an older
`updated_at`, so if anything wrote to the main table that way, judge its rows
by their values, not by the date.

Recovery, after upgrading: run `nextly db:sync` (or start the dev server, or
run `nextly migrate`). For an entity whose localization was turned off, the
earlier pass never recorded the restore as done, so this pass restores the
default language's values from the translation table onto the main table. A
stuck first enable settles on the same pass.

A migration file that turns localization off was never affected: its own
statements restore and archive before the translation table is dropped.
