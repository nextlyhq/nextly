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

A plugin, or server code through the Direct API, can now change one field of an entry on its live copy and on every pending draft that holds it, in one step, without publishing anything: `ctx.services.collections.rewriteField(request, opts?)` and `nextly.rewriteField(args)` (both `@experimental`).

- **Drafts stay drafts.** The live copy and each draft holding the field are written in one transaction, and the entry's status doesn't change. A shared field is written to every language's draft; a translated one (`locale`) only in that language. A draft whose author had edited the field publishes its own rewritten value later, rather than being refused for disagreeing with the live copy.
- **Only from the version the caller read.** `expectedVersion` is required, and an entry saved since is refused with `STALE_VERSION`, with nothing changed. There is no overwrite.
- **A value, or a function of each copy's own.** `set: { value }` gives every copy the same value; `set: { from(current, copy) }` computes each copy's value from what that copy holds, for jobs such as turning a component's copies into plain blocks.
- **History says who and why.** One `field-rewritten` event names the field, each copy changed and the required `reason` (kept as the event's note). A rewrite a plugin makes on its own behalf names the plugin, from its own identity; history has a new `plugin` actor kind. It is never recorded as an overwrite.
- **Refusals.** The id, status, slug and timestamps, a unique field, a field stored in tables of its own (a field group, a many-to-many relationship), a password and a virtual field are refused, as is a value the field's own checks refuse. Made for a person, it needs their permission to update the entry and, where the collection has a publish lifecycle, to publish it, and every field rule of their own update.
- **No save hooks.** A rewrite runs none of the collection's or fields' save hooks and no in-transaction handler. The live change records the `entry.updated` event, announces the update to subscribers once it commits, and revalidates the entry's pages.

A collection entry only, for now: Singles are not rewritten yet.
