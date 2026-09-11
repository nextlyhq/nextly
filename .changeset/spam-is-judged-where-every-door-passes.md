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

Honeypot and rate limiting ran in the form route. The submissions collection
grants public create on purpose, so a visitor can submit without an account,
which makes the generic collection create a second public door and the Direct
API a third. Submissions arriving that way were stored with no rule having
looked at them.

Both now run at the write seam every door passes through, and only when a
request produced the write: a seed, an import or a scheduled job is not
rate-limited by its own importer. A honeypot hit is still stored flagged rather
than dropped, so a false positive stays reviewable. A submission over the limit
is refused, and the form route still answers its own visitor with a success so
a bot learns nothing from the difference.

The rate-limit window moved out of a `Map` private to this package and into the
deployment's own store, the one the REST and auth limiters already share.
Configure `rateLimit.store` once and all three count together. A private Map
counts per process: across several, the effective limit becomes the configured
number times the number of instances, and it fails open under load.

`cleanupRateLimitStore`, `getRateLimitStoreSize`, `clearRateLimitStore` and
`isRateLimited` are no longer exported. They existed to manage that Map.
