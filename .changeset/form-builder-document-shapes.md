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

`SubmissionDocument.status` now includes `"spam"`, and gains `spamReason`.

The stored field has always offered `spam`, the admin has a Spam tab and filters its other views
with `not_equals: "spam"`, the notification hook skips it, and marking something "Not spam" moves
it back to `new`. Only the TypeScript type disagreed, so it described a shape the database cannot
produce — narrowing on `status` could not see the case that actually reaches the UI.

The conversions from a stored row to this plugin's document types now live in one module rather
than at six call sites. They are still unchecked assertions, which the module says plainly:
the services layer answers with a loose row and TypeScript has no overlap to verify. Nothing about
runtime behaviour changes; the unchecked step is now in one place a reviewer can find.
