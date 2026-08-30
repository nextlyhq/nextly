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

The admin dashboard now shows only what the signed-in caller is permitted to
read. Previously a caller holding NO read permissions was treated as having no
filter at all, so the least-privileged account saw every collection; the
activity feed applied no permission filter of any kind; and recent entries were
read with hand-built SQL that bypassed access control entirely.

Operators should expect restricted users to report an EMPTIER dashboard than
before, and that is the fix rather than a regression. A user without read
permission on a collection no longer sees its entry count, its draft/published
breakdown, its recently-edited entries, or its activity-feed rows — including
the entry titles, author names and author emails those rows carry. The
"changes in the last 24 hours" figure is now counted over the same permitted
collections instead of over every collection.

API keys are judged on their OWN stamped grant rather than on the roles of
whoever minted them. A deliberately narrowed key issued by a super-admin
previously inherited that super-admin's reach on the dashboard endpoints; it
now sees only the collections it was actually granted.

One failure mode is deliberately visible as an empty dashboard: if the
permission lookup itself fails transiently, the dashboard answers HTTP 200 with
nothing in it rather than falling back to showing everything. An empty
dashboard that should not be empty is worth investigating in the server logs.
