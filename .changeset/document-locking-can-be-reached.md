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
---

Document locking shipped as three unused tables. The engine was complete —
claim, renew, release and sweep across every dialect, with a heartbeat derived
from the lease clock and a claim token so a renew proves it is the same claim —
and nothing could reach it, because no service bound the adapter its functions
take and no registration constructed one.

`documentLockService` is registered now. It is advisory and says so: a held
document is reported to whoever asks and no write is refused, so a claim left
behind by a closed laptop cannot strand content. The claim token means
enforcement stays available later without redesigning the shape.

Locks run on the pool rather than a caller's transaction. A claim taken inside
a write that later rolls back would vanish with it, and the point of a claim is
that it outlives the request that took it.
