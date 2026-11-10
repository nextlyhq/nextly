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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

Saving the site's breakpoints without one of them, confirmed with `confirmRemoval: true` and the `version` its dry run answered with, now removes every style and per-device hide stored under it across pages, drafts, components, patterns and shared styles (locked and code-supplied ones included); an unconfirmed save stores the set and touches nothing else, as before, records the removal in the audit trail, and allows one removal at a time. A breakpoint save made from an out-of-date read of the site style is refused instead of overwriting a save made in between, and a removal that a later write reopens is carried on by a background job. Existing installs apply the new table with `nextly migrate` before deploying.
