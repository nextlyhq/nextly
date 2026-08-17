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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

fix: supersede the autosave recovery point on a real save

Saving now deletes the saving author recovery point, on both the collection and
Single write paths, inside the write transaction.

This removes a comparison that could not be made correctly. Deciding whether to
offer recovered work compared a version timestamp against a document timestamp,
and those live in different tables that do not share a clock: one records UTC
and the other local time carrying a Z. The comparison was wrong by the server
offset and silently withheld every offer on a Single. A row that exists only
while there is unsaved work needs no comparison.

Scoped to the saving author, so another editor unsaved work survives. Inside the
transaction, so a failed save leaves the recovery point rather than destroying
the only copy of work it did not store.

Also moves the Single recovery banner into the main column: above the flex row
it sat under the sticky header, which intercepted pointer events, so the offer
was visible and its buttons were not clickable.
