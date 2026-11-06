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

Every CLI command that changes the schema now holds the one schema lock, and the development start's schema sync waits for it. `migrate:fresh` keeps the lock tables through its drop, and a failed re-apply releases the lock before the command exits. `permissions:cleanup` reads and deletes under the lock. `prune` and `db:sync --promote`/`--demote` ask first and take the lock only for the change, reading again under it. If what you agreed to changed in between, nothing is changed and the command stops with `PLAN_CHANGED_AFTER_CONSENT` (exit 1). `migrate:status`, `migrate:check`, `migrate:create` and the field-groups preview still take no lock.
