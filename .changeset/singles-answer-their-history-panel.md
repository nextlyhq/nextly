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

The Single editor ignored its own version history. The history panel is
mounted from the system header for collections and singles alike, and it
publishes the clicked version through shared document context — but only the
collection entry editor provided that context and answered it. In a Single the
publication reached the context default, whose setter does nothing, so
choosing a version fetched the snapshot and marked the row active while the
live document stayed on screen: a control that visibly did nothing.

The document side of history — the held version, the provider, the banner
over the read-only snapshot with restore and return-to-current, the
version's own takeover-aware body layout, the loading and failure states,
and the holds autosave and language actions observe while a version is on
screen — now lives in one host that both editors mount, so the two cannot
answer the same panel differently again.
