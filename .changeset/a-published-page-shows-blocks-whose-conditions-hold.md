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

A published page now shows a block whose visibility conditions hold. The route reads the entry it shows, once and as an anonymous visitor reads it (its published values, and only the fields the public may read), and decides each block against it: one whose conditions hold is served, and one whose conditions do not hold, or cannot be checked, is left out of the HTML, its styles and the page metadata. A block inside a collection list is decided for each entry the list draws. Conditions that cannot be checked are logged by the route, beside bindings that show a fallback. `BindingIssuesHandler` now receives `PageIssue` values, a binding issue or a condition issue (`kind: "condition"`), and `isBindingIssue` tells them apart.
