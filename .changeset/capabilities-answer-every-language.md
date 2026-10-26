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

The `@experimental` `GET /me/capabilities` answer gives each collection and Single a cell for each request the admin sends whose languages differ from its action's own: `readTranslations` (a read with every language's translation state, such as a localized list or a document with `translation-status`), `readHistory` (the version history of every language), `publishEveryLanguage` (publishing every language at once, the publish rule asked once for each configured language), `createInDefaultLanguage` and `updateInDefaultLanguage` (a create or an update sent with no language, which writes the default one; a Single has no create), and `duplicate` (a copy of an entry: the source read and the create, in the default language and its fallbacks, and publish too where the collection has a Draft/Published lifecycle, since a copy of a published entry is created published; collections only). A cell answers for every document of its collection, so where the request depends on the document (`publishEveryLanguage`, `duplicate`) it takes the strict side and never offers what the route might refuse for some document. Each is the answer the route gives that request. `GET /me/permissions` now returns `validUntil`: when the permission list stops holding, the soonest end of a role assignment it was read under, or `null`.
