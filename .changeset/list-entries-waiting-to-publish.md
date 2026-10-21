---
"nextly": patch
"@nextlyhq/plugin-accounts": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-commerce": patch
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

A collection's list can now be filtered to the entries waiting to publish, through two reserved conditions in `where` (experimental):

- `_pendingChange: true` keeps entries whose draft holds changes not yet published, in any language.
- `_inRelease: { scheduledBefore }` keeps entries a scheduled release will publish after now and no later than that instant. `_inRelease: true` drops the upper bound.

An entry is kept once, however many of its languages or releases hold it. A release's unpublish members are not counted. Neither is a release past its time, or one not scheduled.

Each condition works in the JSON and the bracket form of `?where=`, beside any other condition at the top level of the filter. It is refused inside `and` or `or` (`FILTER_MISPLACED_KEY`), and for any value but those above (`FILTER_INVALID_OPERAND`). `_inRelease` also needs the right to read content releases. A caller without it is refused exactly as for a condition that does not exist, so the filter reveals nothing about what releases hold. The list's total and the count endpoint count the same entries the list returns.

The admin's entry list keeps these conditions, and the language filter, at the top level of a filter it receives in its address, when its own status and date filters are added.
