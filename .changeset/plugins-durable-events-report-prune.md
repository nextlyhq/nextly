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

Durable plugin events can now be inspected and settled. `nextly events report` lists every delivery that needs an operator: held for a subscriber that is not registered, or out of attempts. `nextly events abandon <delivery>` or `--subscriber <key>` gives deliveries up, keeping their attempts and last failure; `--dry-run` names them first. The dispatcher warns in its log when a subscriber's deliveries become stuck, and again at most once an hour while they stay so. A delivery whose subscriber is not registered is now marked `held`, and keeps its last failure; it runs again as soon as its subscriber is registered. Finished events are removed 30 days after their last delivery settles, with their deliveries, by the retention passes and the scheduled drain; an event with a delivery still owed is never removed. Experimental.
