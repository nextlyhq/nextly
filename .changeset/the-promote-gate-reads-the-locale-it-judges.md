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
"@nextlyhq/plugin-form-builder": patch
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
"@nextlyhq/plugin-mcp": patch
---

The publish gate resolves the caller's permissions before it opens the write transaction, reads the language it is judging, and judges the state the write actually commits.

Three corrections to the gate that re-judges a Single's pending change at publish. The permission lookup was constructed before the transaction but not performed until the gate asked for it, which was inside the transaction: on a one-connection pool that query waits for the connection the transaction is holding and the publish hangs. It is performed up front now, and the gate is handed the answer.

A localized Single's live values are on the companion row of the language being published, and the comparison read only the main row, so a translated field the publisher may not write, resubmitted unchanged by a full form, compared against nothing and read as a forbidden edit. The publish was refused although it changed nothing anyone objected to. Both publish paths now overlay the companion values of the language they are judging.

Publishing every language applies each snapshot to the same main row, so a shared value that a later language overwrites is not the value that lands. The gate judged each language with its own snapshot laid over the combined state, which put those superseded values back and could refuse a publish whose committed document is valid. Only the language's own translations are laid over the final shared state now.
