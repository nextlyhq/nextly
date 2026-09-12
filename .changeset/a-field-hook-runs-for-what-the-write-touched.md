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

A field hook now runs for the fields a write touched, and reads the whole row
either way.

A localized update assembles the complete translation onto the row it returns,
because the version snapshot and the outgoing events describe a translation
rather than the one field of it that moved. Field hooks were selected by what
was present in that row, so an `afterChange` handler on a sibling nobody
edited started firing for an unchanged value — sending mail, re-indexing and
calling out for a field the write never named.

Which handlers run and what each handler can see are now separate questions.
The set of touched fields decides the first; the row stays whole, so a hook
that derives a search document from an unchanged neighbour can still read it.
