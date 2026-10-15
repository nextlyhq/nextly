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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

The limit store and the plugin limiter tighten what they promise.

- A plugin limiter reservation now carries `epochs`, which run of each entry counted it, and `release` gives back only to that run. So a count made before a `reset`, even in the same millisecond, has nothing to give back. An entry remembers the releases it gave, and when it must let the oldest go to stay within its size, it refuses anything counted that early rather than give it back twice: at worst a client waits out a count it might have had back. (`AdmittedReservation` is `@experimental`; one built by hand needs `epochs` now.)
- A key holding a lone surrogate is refused by every limit store and by `ctx.limits`, since it would encode, and count, as another key.
- An empty `NEXTLY_SECRET` names a database limit store generation of its own, apart from no secret, as the install's other secret-derived values judge it.
- The "filling" warning is judged on what a store holds: the memory store after any sweep, and the database store only once an update has committed.
- The exported `limitStoreContract` runs a store with `shared: false`, given each instance's own, through its cross-instance cases on one handle (each case is now marked `acrossInstances`). Its sweep case also requires a second sweep to find nothing left.
