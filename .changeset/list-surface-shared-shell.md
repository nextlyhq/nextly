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

Admin lists now share one layout above the table. Search, filters, the columns control, the
selection bar and the empty state came from four different arrangements depending on which page
you were on, so the gap above the table and the width of the search field changed as you moved
around the admin. They now come from one place.

The columns control is part of that shared layout rather than living on a single page, so it is
available to every list that wants it instead of only to collection entries.

An empty list now says something different when a search or filter is applied: it tells you the
query matched nothing, rather than inviting you to create your first record when the records are
only filtered out.

Tabs draw the rail their indicator was designed to sit on. Each tab drew a 2px underline and
pulled itself up onto a line the tab strip was not drawing, so that underline landed on whatever
followed the tabs — including, above a rounded panel, its corner.
