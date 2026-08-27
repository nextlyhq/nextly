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

Each style control can now say which breakpoint its value came from, and act on
it: a value set at the tier you are editing offers to reset, and a value
arriving from another tier offers to go there.

Only controls that have earned an action get one. An unset control offers
nothing, so a panel does not fill with buttons for values nobody has touched.

Reset names what it will reveal rather than only that it clears — in a
desktop-first cascade a value usually falls back to a wider tier, and not
always to the base one.

Going to a tier sizes the canvas to it. There is no second setting for which
breakpoint you are editing, so the canvas and the inspector cannot disagree.
