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

A text column keeps the width the builder that created it gave it.

A text field that states no width does not have one right answer. Three builders create tables and
they read a width from different keys and read silence differently: the Schema Builder's collection
creator bounds on a short variant, its field-group creator bounds on a declared `maxLength` and
never looks at a variant, and code-first tables were built with a bounded default. Which rule
applies is a fact about the entity, not about the field.

Describing a column without that fact meant guessing, and each place that guessed got it wrong for
at least one builder. On MySQL a field group's short text field was described as unbounded when it
had been created bounded, so a schema preview reported a type change on a column nobody had
touched, and applying it would have rewritten the column. The same guess reached the localization
companion tables, Single identity seeding, and the path that adds a column to a table that already
exists.

The builder is now named wherever a column shape becomes DDL, so the width follows the table rather
than being re-derived from the field. Paths that only look a table up to run a query are unaffected:
a declared width is enforced by the database, not by the ORM.
