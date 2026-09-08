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

A generated type for an optional field now admits null, because the column
does. `field.required !== true` is what decides column nullability in
`field-column-descriptor.ts`, so an unset optional field is read back as SQL
NULL — and nothing on the collections read path turns that null into
undefined. The emitted `field?: T` claimed only that the key might be absent,
which is a different statement and one the database never makes: a consumer
writing `entry.subtitle.trim()` type-checked and threw at runtime.

Optional fields now emit `field?: T | null`.

The `?` is KEPT alongside `| null` rather than replaced by it, which is the
part worth stating. The input types are derived from the entity interface
(`CreateInput = Omit<...>`), and the same emission builds the field-group
interfaces that nest inside entity fields, so dropping `?` would demand an
explicit `null` for every optional key at every depth on create. A wrapper
could relax the top level; it could not reach the nested ones. Prisma and
Drizzle drop `?` because their row types are flat and their inputs are
generated separately rather than derived — the shape here is Payload's, for
the same nesting reason.

`unknown` is left alone, since it already admits null and the union would be
noise in a file a user reads. Required fields are unchanged: their columns are
NOT NULL, so offering null would send every consumer down a branch that cannot
happen.
