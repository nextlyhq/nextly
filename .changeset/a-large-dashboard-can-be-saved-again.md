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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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

A dashboard with more cards than one save may carry can be saved again

When a person regains access to many cards at once, their arrangement can hold more than one save may carry, in number of cards or in size. Saving now leaves out cards they have removed, latest first, until it fits. Cards still on their dashboard are never left out.

`nextly/config` now also exports `layoutSizeProblem` and `MAX_LAYOUT_BYTES`, the layout endpoint's own check of whether a submission fits.

Retired dashboard widgets now merge only into the same card of their successor, as the widgets specification describes, and a widget retired twice reaches the widget that exists now. This release retires no widget, so no dashboard changes yet.
