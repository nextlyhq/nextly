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

A write that changes only an entry's status, a publish or an unpublish, is now judged by its own permission and code rule alone. Before, it also needed the update permission and update rule, so a role that may publish but not edit could not publish at all. A publish-only caller sends the status alone, `{ "status": "published" }`, and the pending draft, if there is one, goes live with its fields still judged by their own rules. A write that names any other field, even at its current value, needs update too, and without it nothing is written, the status included. This holds over REST, the Direct API, a plugin's services, batch and query updates and Singles; publishing or unpublishing every language needs only its own permission, and the admin's capabilities answer publish the same way.
