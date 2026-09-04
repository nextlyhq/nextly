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

A block hidden by a visibility condition no longer draws the components inside
it. The condition already removed that block and everything under it before a
reader saw the page, but the components in it were still being loaded and
counted — so a page could be refused for publishing over a component nobody
could be shown, and a change to that component still made the page rebuild. A
component held directly by a hidden block was already treated this way; now a
component held further down is too.

A component whose stored data cannot be read is described as unreadable rather
than missing wherever that is reported, so the fix offered is to repair the
component rather than to publish one that already exists.

A page with an unrecognised note about a component that failed to load no
longer takes the whole page down with it.
