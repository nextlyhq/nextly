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

The setup checklist no longer vanishes from a reader who still has a step to do.

Whether the card was allowed to drop itself was settled by comparing when its
answer arrived against when it mounted, and a wall clock cannot make that
comparison. `Date.now()` is deliberately coarsened by browser
anti-fingerprinting -- to 100ms buckets under Firefox's resistFingerprinting --
so both readings can land on the same value; and it steps backwards under a
clock correction, which can place the mount before an answer that genuinely
predates it. Either one let the card act on the previous visit's completed
answer and drop itself while a step was still outstanding.

It now asks the query observer how many answers have arrived since it
subscribed, a count that can neither collide nor run backwards, and requires
that answer to have succeeded: a refetch that fails leaves the earlier
completed answer in place, and a failure to refresh is no longer read as
progress.
