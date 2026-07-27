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
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Content pages can now use tag-based ISR: cache a read with `cachedFind` and tag it with `nextlyTags` from `nextly/runtime`, and every content change (create, update, publish, unpublish, delete, or slug rename) busts exactly those tags so the page regenerates on the next visit — no rebuild, no `force-dynamic`. Revalidation turns on automatically wherever you mount the admin route (`createDynamicHandlers`). A per-operation `disableRevalidate` flag lets a bulk import, seed, or CLI write skip it. See the new "ISR and caching" guide, including the rule for keying a per-user read so it cannot leak across callers.
