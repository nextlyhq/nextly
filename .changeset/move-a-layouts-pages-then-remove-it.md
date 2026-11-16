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
---

Remove Layout can move the pages that use a Layout to the site default, then
delete or unpublish it. Until now a Layout any page used could not be removed
until each page was given another Layout by hand.

The dialog lists the pages with where each names the Layout, says how many
published pages switch to the site default's header and footer once the Layout
is gone, and moves the unpublished pages and unsaved edits a batch at a time as
the person, with a progress bar and Stop. A page they can't edit is left and
named with the reason, and the Layout is kept while any such page remains.
Stopping, or closing the dialog, keeps the Layout and every page already moved.

The route takes `"move": true` for each batch. A dry run's `check` now also
answers each page's `state`, `liveRows` and `siteDefault`.
