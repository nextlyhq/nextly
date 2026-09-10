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

Four repairs to the dashboard's onboarding card, and one performance fix behind
it.

Declining the offer of demo content now drops the card from the open dashboard.
Skipping used to change nothing the server could see, so only a successful seed
refreshed the arrangement; the card's condition reads the decline now, which
left the one gesture that could strand a placement the server had stopped
offering — visible in edit mode, and refused on save.

A step this build cannot name no longer reads as a finished checklist. Dropping
an unreadable row keeps the card from breaking, and on its own it introduced
something worse: a newer server reporting an outstanding step under a name this
build does not know would leave every remaining row complete, so the card
announced itself finished and asked to be taken down while the server went on
offering it.

The checklist follows a schema change. Two of its steps are answered from the
collection registry, so creating a collection in another tab moved the answer
without moving the card, which went on asking for a collection that existed.

One layout read now resolves the reader's collections once. Two conditions ask
overlapping questions of the same rows, and each was resolving them
independently — three authorization traversals and two counted reads per
collection for a single dashboard load.
