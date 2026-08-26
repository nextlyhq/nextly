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

Narrowing a column's precision or length now generates a migration.

Changing a decimal from `numeric(10, 2)` to `numeric(5, 1)`, or a text column from `varchar(255)` to `varchar(20)`, produced no operation at all: the Schema Builder reported no changes, no migration was written, and the column kept its old size. The two declarations reduce to one type name, and the diff compared only the name.

That was a deliberate trade-off when it was made — the note in the column builder says as much, and states the condition for lifting it: "resizing a decimal column needs a manual migration until the introspector captures numeric_precision/numeric_scale on the live side". The introspector has since done exactly that. The comparison now reads the declared size alongside the type name, so a resize is seen.

Sizes are compared only when both sides state one. A column that is `varchar(255)` in the database against a field that asks for plain text is not a resize — it is two descriptions at different levels of detail — and treating it as a change would emit an operation on every apply against an existing database and never converge. That is the failure the name-only comparison existed to prevent, and it stays prevented.

A resize was already classified as a destructive change, so it is confirmed before it runs rather than applied quietly. It now says what it is doing: the operation carries both declarations, where it previously carried the bare type name and would have described the change as "from 'numeric' to 'numeric'".

A resize keeps the column's other attributes. MySQL spells a type change as `MODIFY COLUMN`, which restates the whole definition and drops whatever it does not restate — so a `NOT NULL DEFAULT '0'` column would come out of a generated resize nullable and defaultless, with no schema push behind the migration to put them back and no way for its DOWN to recover them. Both pairs now travel with the types.
