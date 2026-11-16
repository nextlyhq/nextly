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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

Two refusals that aren't about permission now say why, and stay 403 `FORBIDDEN`.

A change or delete of a collection, Single or component defined in code, made from anywhere but its code, reads "This collection is defined in code, so it can't be changed here." (or "deleted", or "Single", or "component"). An autosave where the collection or Single doesn't autosave reads "Autosave is turned off for this collection." (or "this Single"). Both used to read "You don't have permission to perform this action.", which sent people looking for a permission that wouldn't help.

One status changes. The admin's schema routes checked the lock themselves and answered a thing defined in code with a 500 internal error: changing a Single's schema, previewing or applying a schema change to a collection, Single or component, and deleting a Single. They now answer 403 with the same sentence.

Refusals for want of permission are unchanged: they never say which check refused.
