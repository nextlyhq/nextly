---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-mcp": patch
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

The page builder marks a bound value a visitor will not see. When a block on the canvas is bound to a field the public may not read, so the published page shows the binding's fallback, the block carries a "Visitors won't see this" badge above its corner. A keyboard reaches the badge, its tooltip names the field and what visitors see instead, and pressing it selects the block. The inspector says the same under the bound prop. The canvas, checking bindings against the same public fields, draws the fallback too; the badge says why.

`@nextlyhq/blocks-engine` adds `visitorUnreadableBindings` (`@experimental`): the bindings in a document that the published page's own binding check, given the field shapes a visitor may read, falls back on. `@nextlyhq/builder/shell` adds `VisitorUnreadableBadges` and `VisitorUnreadableProvider` (`@experimental`), which draw that answer on the canvas and in the inspector.
