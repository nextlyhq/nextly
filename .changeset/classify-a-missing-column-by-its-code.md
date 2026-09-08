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
"@nextlyhq/plugin-form-builder": patch
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

Classify a missing column by the driver's error code rather than by the wording of its message.

Three call sites answered "did this statement name a column the table does not have" independently, and the three disagreed. Two matched English message text; between them they covered disjoint MySQL errors, so each was blind to the case the other handled — a staleness read recognised `Unknown column` (1054) but not `Key column ... doesn't exist` (1072), and a degraded index push recognised 1072 but not 1054.

Matching wording is unsound on MySQL regardless of coverage: `lc_messages` selects among roughly twenty translations, has session scope as well as global, and can be changed at runtime. A server answering in any other language defeated the match silently, and in the dangerous direction — the predicate returned false, the caller concluded the column was present, and the tolerance it exists to provide was skipped.

The single implementation reads the driver code first, per dialect, walking the cause chain where drivers actually put it. Wording is still consulted for a level whose code does not classify: SQLite exposes no code for this, and a wrapper may drop one. Because the code is read first, the wording no longer has to survive translation.

Two narrower views derive from it rather than reimplementing it: whether a specific named column is the missing one, and which of the two forms the error reports, since only MySQL separates an index's missing column from a statement's.
