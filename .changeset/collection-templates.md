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

The page builder gains collection templates: a `templates` collection of builder documents of kind `template`, each naming the collection whose entries it draws in a unique `collection` field. A collection has one template whatever its state, so a second is refused when it is created, naming the first, and the database refuses one that gets past that check, on every dialect. A template's collection is fixed while that collection exists, and may be pointed at another once its own is renamed or deleted. `POST /templates/actions` and the composition service's `templateAction` create a template (`create-template`) and publish one (`publish-template`), each with a dry run that answers refusals, asking the caller's rights first. The schemas are published as `templateActionSchema` from `@nextlyhq/builder/ops`. The collection is built by the schema pipeline from its fields, with no migration file, and stays out of the admin's navigation until its screens ship. Templates are not served yet: nothing renders an entry with one in this release.
