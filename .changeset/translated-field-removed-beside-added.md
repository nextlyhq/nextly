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

A Schema Builder save that removes a translated field while it adds another field, with no rename decided for them, is now refused before anything changes. Two renames in one save, a rename beside a new field, and a rename to another type were each read as a removal and an addition, which dropped the removed field's translations column and every language's value with it, and no step of the save asked about it. The refusal (`TRANSLATED_FIELD_REMOVED_BESIDE_ADDED`) names each such field and the two saves that work: rename or remove one translated field and save, then add or change the others. A schema dialog's explicit "drop and add" answer still goes through, as the admin chose it.

The settings save that turns translation on is refused the same way for a field that becomes translated, a rename included: turning translation on keeps a field's value only under the name it already has, so the removed field's value was deleted from the main table and its replacement started empty. Turn translation on with the fields as they are, then rename or add. The schema dialogs already ask for that drop to be confirmed, and still apply it once it is.
