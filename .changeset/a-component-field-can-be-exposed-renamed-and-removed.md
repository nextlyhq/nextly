---
"@nextlyhq/eslint-plugin": patch
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

Edit an existing component's exposed fields from code. `planExposeProperty`, `planRenameExposure`, `planRetargetExposure`, `planRemoveExposure` and `planRemoveExposedSlot` (experimental) expose a block prop or a node's visibility, with its type inferred from the prop, then rename, re-point or remove it. A removed field's id is retired and never minted again. Its value is pruned from every variant in the same edit, and a type change gets a new id. A design prop inside a `contentOnly` area is refused when it is exposed. `stripRetiredExposures` takes a removed field's values and a removed slot's content out of any document that places the component. A variant left with no values is now a warning (`variant-empty`) rather than an error, and shows the component's defaults.
