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
"create-nextly-app": patch
"nextly": patch
---

A Recent entries card's reader can choose which of the collection's fields its rows show after
the title, from a new "Fields on each row" setting.

- `settings.fields({ of })` declares a `fields` content setting on a widget (`@experimental`): an
  ordered choice of the named Collection setting's fields.
- A choice must name only fields the reader is offered, the rule a Sort or Filter is held to. A
  field a read rule withholds is never offered, and a stored choice naming one falls back to the
  card's own fields, so it is never asked for.
- The settings sheet draws it as a multi-select of the offered fields, and resets a stored
  choice naming a field no longer offered, saying so.
- Recent entries leads each row with its collection's initial, draws each chosen field on the meta
  line and a field of choices at the row's end, and draws its status as a pill.
- Every content setting's control names a field by its label, or its name made readable, as the
  card's column headings do, never by its key.
