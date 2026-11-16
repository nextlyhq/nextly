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

A field group or Single something depends on can no longer be deleted. While a field of a collection, a Single or another field group places the field group, a foreign key a plugin or the app declares points at its table, or a plugin or the app has added a column, index, foreign key or check to it, the Schema Builder's delete, the schema API and the Direct API's `fieldGroups.delete()` refuse before anything is removed, naming each with its owner and table and saying what to do. A Single is refused the same way, through the Schema Builder and the schema API, for a foreign key into one of its tables or another owner's element on one. Where those cannot be read the delete is refused rather than going ahead; before, a field group's refusal named nothing, and a registry it could not read was taken for one that held no use. A field group's delete now holds the schema lock from its check to its last drop. `FieldGroupRegistryService.findComponentReferences` is deprecated, and now throws when a registry cannot be read instead of returning the references it could read. Fixed: a relationship or upload inside a group with no name was not counted as pointing at its collection, so that collection could be deleted while still pointed at; it is now found and named at the level it is stored, and so is a field group placed inside one.
