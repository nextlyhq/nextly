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

Fix scheduling a release, which failed for every request the admin sent. The check that refuses an impossible date read the UTC offset from a fixed position in the string, and the offset does not sit at a fixed position: seconds and milliseconds are both optional in the accepted format. `Date.prototype.toISOString()` always writes milliseconds, so every schedule request from the product carried a shape that made the check compute an unusable date and fail with an internal error. Two quieter faults came from the same line — an instant written with a real UTC offset had that offset read as zero, so a moment shortly after midnight was judged against the previous day and refused as a date that does not exist, and the impossible-date check it performs was silently doing nothing wherever milliseconds were present. The offset is now read from the end of the string, and the accepted shapes are covered by tests written from what a client actually sends rather than from what is convenient to write by hand.
