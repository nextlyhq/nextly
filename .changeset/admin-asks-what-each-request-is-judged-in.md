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

The admin asks each request it sends as the server judges that request: the localized list, the editor and quick-edit ask for every language's translation state only where the server lets the user read them all, the list and quick-edit in the default language their reads are sent in, and otherwise show no Languages column or language filter; the version history and its compare pages are offered only to a user who may read the whole history, in every language, and are not offered at all otherwise; Publish all languages warns that languages whose state could not be read may go live too; Publish all languages, a create (sent with no language, so in the default one) and the quick-edit modal's save each follow their own answer from `GET /me/capabilities`. The permission list is asked again when the role assignment it was read under ends. `/me/permissions` answers an API key with the key's own permissions.
