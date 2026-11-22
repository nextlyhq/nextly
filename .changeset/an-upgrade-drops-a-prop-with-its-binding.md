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

A block's upgrade can now drop a prop cleanly. A version step may name the props it
drops (`drops`, beside `renames`, `@experimental`): once the step has run, the prop's
value goes, any value bound to it goes with it, and any component setting exposing it is
removed, so an upgraded page or component holds nothing addressing a prop the block no
longer has. A node whose only binding was dropped is left with no bindings at all.

The Table of contents' version 1 `content` and the Form's version 1 `method` now drop
this way, so a Table of contents bound to an entry's body no longer leaves a binding
that fills nothing (and a row in the bindings report) after its upgrade. Stored content
changes only when it is read and upgraded; nothing else is rewritten.
