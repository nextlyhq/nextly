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

Plugins can emit durable events: `ctx.events.emitDurable(name, payload, { tx }?)` records an event the plugin declares `durable: true` in `contributes.events` with the work that emits it, by the same rule as `emit` (the plugin's transaction, else the one the calling code is in, else one of its own), and `ctx.events.onDurable(name, subscriber, handler)` subscribes under a name unique within the plugin. Every subscriber registered when an event is dispatched receives it at least once, retried with backoff across restarts, on the `events:dispatch` job, and promptly after the emitting work commits inside a request (one dispatch at a time per process, never delaying the response). `DurableEvent`, `DurableHandler` and `PluginDurableEvents` (the type of the two methods; `PluginEvents` is unchanged, and `ctx.events` is both) are exported from `@nextlyhq/plugin-sdk`. A hand-written `PluginContext` double (a test mock or a wrapper) adds `emitDurable` and `onDurable` to its `events`, for example as `vi.fn()`, as it added `ctx.security` and `ctx.dialect` when they came. Experimental.
