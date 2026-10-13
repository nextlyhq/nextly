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

Close three ways a plugin's typed `ctx.db` could reach past its checks.

- `ctx.db.query` no longer hands out Drizzle's raw query entry through reflection, such as `Object.getOwnPropertyDescriptor(ctx.db.query, "users").value`, and an assignment to it no longer replaces an entry in the namespace core queries through. Only a table the plugin may reach is described, and only by its checked entry.
- A method taken off the handle `ctx.db.raw.transaction` passes, such as `const insert = tx.insert`, is refused when it is called after the transaction has finished, as a property read already was.
- The plugins a plugin may reach through `ctx.db` are read from the config in force, so a development reload that removes a dependency from `dependsOn` or `optionalDependsOn` takes away its tables without a restart.
