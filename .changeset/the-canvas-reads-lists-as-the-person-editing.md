---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-mcp": patch
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

The page builder's canvas draws a collection list with the entries the person editing may read, drafts included, as they would see them in the admin, instead of the entries a visitor would see. Their row and field access applies exactly as it does to their own reads; a collection they may not read is refused as it is in the admin. The published page is unchanged: it still reads every list as a visitor, published entries and public fields only, so a draft shown on the canvas never reaches it. A filter or sort the published page would refuse is refused on the canvas too.

`nextly/runtime` adds `createEditorReader` and `toEditorFind` (`@experimental`): the public reader's queries, keys, refusals and limits, read as a named person with every state included, and never cached.
