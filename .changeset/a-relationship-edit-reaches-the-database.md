---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

An edit to what a relationship does when the row it points at is deleted now
reaches the database.

A foreign key carried the actions the statement that CREATED it wrote, and
nothing else ever changed them. Moving \`posts.author\` from cascade to restrict
saved successfully and recorded restrict, while the database went on cascading
— so deleting an author still destroyed their posts. The same held for a
many-to-many, whose junction kept the actions it was built with.

Both are emitted now, through one implementation. PostgreSQL and MySQL drop
the constraint and declare it again under its own name, as two statements:
MySQL rejects a drop and an add of one name in a single \`ALTER TABLE\`, and on
PostgreSQL a single statement would depend on the order the server applies its
subcommands in. A junction has both of its foreign keys rebuilt, and the table
itself is left alone — rebuilding it would destroy every link it holds for a
change that never needed to touch one.

SQLite refuses the edit by name rather than performing it. It cannot alter a
constraint at all, and the table rebuild that would be required has caused
real data loss in three independent tools that automated it; refusing is what
this dialect already does for a foreign-key drop and for a unique constraint
it cannot enforce.

Three things the statements meet on the way to the database are handled with
them, because emitting the right SQL is only half of arriving:

- They are emitted one statement per chunk. The runner splits a migration on
  its breakpoint markers and never on semicolons, and the MySQL driver is
  configured to refuse a query carrying more than one statement — so a
  semicolon-joined pair was rejected whole, and this edit did nothing at all
  on MySQL.
- Turning a link optional now relaxes its column as well as its key, in that
  order, and turning one required replaces the key before tightening the
  column. A relationship's requiredness never moved its column before: the
  descriptor calls the column nullable whichever way `required` is set, so an
  optional link kept a NOT NULL column while its key moved to `SET NULL` —
  which MySQL rejects outright, and PostgreSQL accepts and then fails on the
  first delete, in production.
- The key that is dropped is the one the table actually carries, read from it
  rather than derived from a naming convention. A column whose key was
  installed under another name, or that carries none because it was edited
  from a scalar into a relationship, no longer aborts the migration.
