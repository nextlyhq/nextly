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
"create-nextly-app": patch
"nextly": patch
---

Listing collections filters by permission BEFORE it pages, so the count
describes the rows the caller can see.

Filtering the already-fetched page instead left the rows and the meta
describing different sets: `total` became the number of survivors on ONE page,
so `totalPages` collapsed to 1 and `hasNext` was false however many pages the
reader could actually reach. A client reading that stops at the first page and
every collection past it is unreachable -- and the pre-filter count it replaced
reported how many collections exist that the reader may not see.

The registry now takes a `slugAllowlist` and puts it in the WHERE clause, so
the COUNT and the page read the same rows. `readableSlugAllowlist` resolves it
once for both the collections and the singles listings, which had two copies of
that resolution; its three answers stay distinct -- no filter, no rows, or
exactly these slugs.
