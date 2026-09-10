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

The setup checklist no longer shows a finished list to a reader who still has
work to do.

Its answer was held as fresh for five minutes and the card is unmounted whenever
it is not offered, so the two combined: a reader who completed onboarding and
then deleted their last collection was offered the card again, and it drew every
row ticked from the answer the previous visit had left behind. It reads what is
true now, and will not report completion from anything it did not just fetch.

Applying schema changes refreshes it too. Two of its steps are answered from the
collections a schema change moves, and the card's own listener is not mounted at
the moment that matters — the answer changes precisely while the card is absent.
