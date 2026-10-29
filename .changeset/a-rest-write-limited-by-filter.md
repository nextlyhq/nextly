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

A REST write is limited to the entries its access rule's filter matches, as a write through the Direct API is: an update, a delete, a publish or unpublish sent as a status change, and the writes an editor makes through an entry's versions (a restore, a discard of the held edit, taking the live shared values, an autosave). The route lets a caller through on the filter its rule answers and keeps it for the request; the write matches the entry against that filter. An entry outside it is refused and left as it was: with a 403 where the caller may read it, and as a missing entry (404) where it may not. A check that cannot apply the filter refuses rather than allowing every entry.

A restore that the update refuses is now answered as the update was: a 403 where the caller may read the entry, rather than a 404 for every refusal.
