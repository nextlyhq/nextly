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

Collection read rules now apply over the REST API. Listing, fetching and counting entries previously ignored who was asking, so a collection configured with an owner-only or role-based **read** rule still returned every row to any caller who could reach the endpoint — the rule only ever held on writes and inside the Direct API. Reads now evaluate the caller against the collection's stored rules, with owner-only scoping applied in the database query so pagination and totals stay correct, and a count can no longer describe rows the caller is not allowed to see.

If you configured a read rule expecting it to be enforced, this closes that gap. If instead something in your app depended on reads returning unfiltered data, it will now see only the rows its rule allows: check any integration that reads with a user session or API key against a collection whose read rule is not `public`.
