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

Workflows store their review state and settings, and seed their permissions. Two new tables hold each document part's stage, assignment and approval, and what admins change for each workflow; `nextly migrate` creates them, and nothing reads them yet. A collection or Single with a workflow gets each step's own permission (`approve-posts`) and `publish-without-review-<slug>`. No API key ever holds `publish-without-review`, whatever its role or creator, and the Admin, Editor and Author presets hold none of a workflow's permissions: grant them to a role. A workflow is refused when one of its permissions could not be stored as its own: a step asking for `publish-without-review`, an action too long to store, or an entity named `without-review-<slug>` beside the one it is attached to.
