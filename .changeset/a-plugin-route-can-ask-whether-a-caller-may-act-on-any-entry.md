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

A plugin route can now ask a type-level permission question: `ctx.caller.can(action, resource, { anyEntry: true })` answers whether the caller may perform the action on any entry at all. It is the same access decision as plain `can`, except that a rule limiting the action to the entries a row filter matches answers yes for a write as it already did for a read. Plain `can` still answers no there, since it names no entry. The option's type, `PluginRouteCanOptions`, is exported from `@nextlyhq/plugin-sdk` and `nextly`. It decides nothing about an entry: the write itself is still judged on its entry. The page builder's site style route uses it, so an author who may update only their own entries of a collection the builder opens can now draw the canvas.
