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

Index the dashboard's pending-edit reads, and resolve the content registry once per query.

`nextly_versions` gains `nextly_versions_pending_edits_idx`, covering the
predicates that define a working draft plus the collection filter and the
cursor's ordering. Every existing index on that table leads with `scope_kind`,
which these queries never constrain, so both dashboard cards answered with a
full table scan: the count's row budget bounded the rows it received and
nothing about the work the database did to find them.

The pending-edit walk now resolves the registry and the configured locales ONCE
per query rather than per page, and derives its candidate collections from the
same snapshot it judges rows against. A registry that cannot be enumerated is
reported rather than silently contributing nothing, so the cards refuse instead
of stating that no document has unpublished edits.

A count that could only establish a floor now renders as one in every archetype
that draws it; `stats` cells previously formatted the total alone and presented
a bounded number as exact.
