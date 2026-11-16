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

`ctx.events.emit` now delivers a plugin's event once the work that emitted it commits. Pass `{ tx }`, the handle `ctx.db.transaction` gives, to tie an event to that transaction: it is delivered when the transaction commits and never if it rolls back. An event emitted inside a transaction the calling code is running in waits for the outermost commit; one emitted inside a savepoint that rolls back, or in an attempt that is retried, is dropped. Outside any transaction, as from a job or a route, it is delivered at once, as before. **Behaviour change:** before, `emit` delivered at once even inside a transaction that later rolled back; a listener now hears such an event only after the commit. `ctx.events` is typed `PluginEvents` (the event bus's methods, with this `emit`), exported from `@nextlyhq/plugin-sdk` with `PluginEmitOptions`. A value typed `EventBus` no longer accepts `ctx.events` as it is; type it `PluginEvents`.
