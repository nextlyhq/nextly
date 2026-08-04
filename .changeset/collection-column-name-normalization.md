---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Resolve a field name to its database column the same way everywhere. A Schema Builder collection
created a field whose name began with a capital under an extra leading underscore, while the
runtime schema and the schema diff addressed it without one — so the table and every read of it
disagreed, and the diff reported the column missing on every apply.

Every decision about which column a field occupies now asks the same question of the same
conversion: which system column an author's field replaces, whether two names collide, which system
fields a config factory injects, and which columns an ALTER may touch. Two fields whose names reach
one column (such as `foo_bar` and `FooBar`) are now reported where the names are chosen rather than
failing during schema application, and editing a many-to-many field's index or flags no longer emits
statements against a column it never had.

Field types that store their values in their own tables, such as a component or a many-to-many
relationship, are consistently treated as occupying no column: they neither collide with each other
nor suppress a system column that still has to be injected beside them.

**Two configurations that were previously accepted are now refused at startup, with an error naming
the fix.** A field may replace the system `title` or `slug` column only under that column's own
name: `title` still works and is unchanged, while `Title` is refused, because it reaches the same
column while remaining a separate identity in every payload — a create carrying `Title` gained a
second generated `title` and the generated value overwrote the author's. And a field whose name
reaches a column the Draft/Published lifecycle owns is refused while that lifecycle is enabled; such
a collection could never have been created, since the column was declared twice. With the lifecycle
off, `status` remains an ordinary field name.

Emitted SQL is unchanged for every field name the Schema Builder accepts.
