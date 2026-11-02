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

A widget can now be tested without a browser. `runWidgetLoad` from `@nextlyhq/plugin-sdk/testing` runs a widget's `load` against a test instance for the person you name, through the dashboard's own route, so that person's access applies exactly as it does on the dashboard, and answers in the card's own states: `ready` or `empty` with the data, `needs-setting`, `unavailable`, `not-shown` or `error`. `renderWidgetCard` from the new `@nextlyhq/plugin-sdk/testing/admin` entry draws the card in the admin's own frame, for a state you name or for what a load answered, at a size and in a light or dark scheme. Both are experimental. They sit in entries no production entry reaches, and the bundle check now refuses any production source that imports one.
