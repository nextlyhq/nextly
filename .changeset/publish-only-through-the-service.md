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

Every change of what readers see goes through the publish service and is judged by its gate on every door. A save that names a status (one language, every language with `*`, several entries at once, a batch, a save on a transaction a plugin opened) and a create that publishes are asked of the publish gate early and again on their own transaction once the entry is locked, and settled before they commit; unpublishing is never gated. `withoutReview: { reason }` in a publish or unpublish body, or `_withoutReview` in a save's body, tells the gate a publish made without review, and is never stored. Singles publish and unpublish chosen parts at `POST /api/singles/{slug}/publish` and `/unpublish`, and the admin's publish menu offers the languages and the shared fields as separate choices (experimental).
