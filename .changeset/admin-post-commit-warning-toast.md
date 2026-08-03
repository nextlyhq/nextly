---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

The admin now reports a save whose follow-up actions failed, instead of showing it as a clean save.

A post-commit hook (`afterCreate` / `afterUpdate` / `afterDelete`) runs once the row is already
durable, so a handler failing there cannot un-save it. The server has always answered success and
carried the failure alongside as `warnings`, but the admin's entry clients returned only `item` and
discarded that array, so a search index that was not reindexed, a webhook that was not delivered or
a cache that was not purged looked identical to a clean write.

Creating, updating or deleting an entry now shows "Entry updated successfully, but 2 follow-up
actions failed" with the failures behind a disclosure. It stays a success toast, never an error:
the row IS saved, and reporting a failure would invite the editor to repeat a write that already
took effect.

`entryApi.create`, `entryApi.update` and `entryApi.delete` now resolve to `{ item, warnings? }`
rather than the entry alone. The `onSuccess` callbacks on `useCreateEntry`, `useUpdateEntry` and
`useDeleteEntry` still receive the entry, so callers of those hooks are unaffected.
