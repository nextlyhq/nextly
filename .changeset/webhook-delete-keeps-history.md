---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Deleting a webhook endpoint keeps its delivery history.

Deleting an endpoint used to remove its delivery log with it, because the delivery table's foreign key cascaded. The record of what was sent to an integration is often wanted right after it is torn down, which is exactly when it used to disappear.

Deleting now retires the endpoint instead of removing it: the row is kept and stamped as deleted, so it vanishes from every read and stops receiving deliveries, but the delivery ledger keeps a real endpoint on the other end of its link. Disabling is still the way to pause an endpoint you mean to bring back; deleting is for one you are finished with but whose record still matters. A retired endpoint is never resurrected, and its outstanding deliveries are ended the same way disabling ends them.
