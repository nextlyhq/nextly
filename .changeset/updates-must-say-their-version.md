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

An update must now say which version of the document it changes, or that it replaces whatever is stored. One that sends neither `_rev` nor `_overwrite: true` is refused with `VERSION_REQUIRED` (428) and changes nothing. Before, it was applied over whatever had been saved since its caller read. Experimental.

**What to change:** send back the `_rev` from your last read of the document with each update, or set `_overwrite: true` when the update means to replace whatever is stored. This applies to REST, the Direct API, the plugin service and `useUpdateSingleDocument`, for trusted server code (`overrideAccess`) as for anyone.

- **Where it holds:** updating an entry or a Single; one item of a batch; publishing or unpublishing every language; taking the live values into a pending change; discarding a pending change; restoring a version.
- **The same values to many documents** (bulk by ids or by query) are refused whole unless they give each id's version in `revs` or choose `_overwrite: true`.
- **Not asked:** creates, deletes, autosave, and a scheduled release's own write.
- **The admin:** a publish of every language, by a role that may not read all of them, now chooses to overwrite.
- **Generated types:** entry and Single types carry `_rev?: string`, and their update inputs take `_overwrite?: boolean`.
