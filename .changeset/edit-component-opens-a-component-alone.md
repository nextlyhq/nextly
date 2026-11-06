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

"Edit component" opens a placed component alone, in its own Page Builder view.

The placement's inspector and the block toolbar offer it, as do the command
palette and the context menu, to an author who may update components. It loads
the component's view with a checked way back to the page, at the placement,
and asks first about unsaved changes. A banner over the component's view names
it, says how many documents place it ("at least" while the count is a floor),
and offers Back.

`ToolbarActionId` (exported by `@nextlyhq/builder`) gains `"edit-component"`.
A `Record<ToolbarActionId, …>` or an exhaustive switch over it needs an entry
for it; `blockActionRunners` already has one, and the new verb is optional on
`CommandVerbs` and `BlockActions`, so a host that builds those keeps compiling.
