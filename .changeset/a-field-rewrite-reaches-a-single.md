---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

A field rewrite (`rewriteField`, `@experimental`) now reaches a Single as it reaches a collection entry, through the same request shape on both surfaces: `{ single, field, expectedVersion, set, reason }` beside `{ collection, id, ... }`, on `ctx.services.collections.rewriteField` and `nextly.rewriteField`.

- **The live copy and every draft, without publishing.** The Single's live copy and each pending draft that holds the field are written in one transaction; each draft stays a draft and the status doesn't change. A shared field is written to every language's draft, and a language draft whose author had edited it publishes its own rewritten value later. A translated field (`locale`) is rewritten in that language only.
- **Only from the version the caller read.** A Single saved since is refused with `STALE_VERSION`, with nothing changed.
- **History and events.** One `field-rewritten` event names the field, each copy and the reason, and the plugin that made it. A change to the live copy records `single.updated` and revalidates the Single; a change to drafts alone records neither. No save hooks run.
- **Refusals and access.** The same fields and values are refused as for an entry. Made for a person, it needs their permission to update the Single and, where it has a publish lifecycle, to publish it.

`RewriteFieldArgs` is now a union of the entry and the Single forms. A read that a field rewrite of a code-defined collection made off its transaction now runs on it.
