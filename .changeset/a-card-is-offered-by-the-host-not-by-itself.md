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

The collections and singles cards no longer decide for themselves whether they
have anything to show.

A fresh dashboard made the same "get started" pitch three times: the setup
checklist, the demo-content offer, and a third panel the collections card drew
on its own when it had no counts. The singles card went the other way and
returned nothing at all when the install had no singles -- and a card that
renders nothing still holds its place in the grid, so the layout reserved an
empty slot on every install that never used them.

Both cards now declare a condition, and the host offers them only while it
holds. Two names join the closed set a conditional widget may use:
`collections:present` and `singles:present`, each true while this reader may
read at least one. They are about what exists rather than what is in it, so a
collection with no entries yet still counts as present -- it is still something
to list -- which is what separates them from `content:empty`. The
`GetStartedEmptyState` panel is removed; the checklist and the demo offer, which
the host withdraws on their own, are the two pitches a new reader meets.
