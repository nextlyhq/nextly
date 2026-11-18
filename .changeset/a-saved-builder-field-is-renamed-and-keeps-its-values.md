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

The Schema Builder renames a saved field through Rename…, in its settings and in its row's menu, and keeps the field's values. A saved field's name is no longer edited in place: it shows fixed, with Rename… beside it, which judges the new name as it is typed by the save's own rules. A field inside a named group or a repeater, or one using a field group, keeps its values under its name where Rename… cannot reach them, so it is not offered there, and says why. An unsaved field's name stays editable.

The save answers a rename the Builder made as a rename itself, on every table holding the field, so its values are kept: the schema dialog shows it as a rename whose values are kept, with no choice to drop and add. When the save's preview does not offer the rename as one, nothing is saved, and the field is named. A condition that reads the renamed field follows it to its new name in the same change, as one undo step.

`nextly/config` publishes `fieldColumnName` (experimental): the column a field's name becomes, which the Builder matches its renames to the save's preview by.
