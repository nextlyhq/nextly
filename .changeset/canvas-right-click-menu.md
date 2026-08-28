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

Right-clicking a block on the canvas opens a menu.

Nothing happened before: the editor had no context menu anywhere, so an author looking for the block's actions where every comparable builder puts them found nothing. The menu offers the same verbs the floating toolbar offers, in the same order, with the same availability and the same reasons — it is another way to reach them rather than a second list that can disagree. A verb that is unavailable stays visible and says why, because a menu that silently drops Delete answers "why can I not delete this" with nothing at all.

Right-clicking a block also selects it first, so the menu always acts on the block under the pointer. Right-clicking one of several selected blocks keeps that selection instead of replacing it.

It is reached by pointer only for now. Every verb in it is already reachable without a pointer through the keystrokes, the block toolbar and the command palette, so this adds a route rather than becoming the only one.
