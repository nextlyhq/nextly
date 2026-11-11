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

The Form Builder adds a field through the shared field picker (search, then a label that names the field) and edits it in the shared settings panel, docked beside the list on a wide window and opened in the field's card on a narrow one. The panel is configured for forms: a dropdown's and radio group's choices, a checkbox as one yes or no, the form's own settings for text areas, files, dates, numbers and hidden fields, only the validation rules a form's checks enforce, and the form's own show-or-hide conditions. A saved field's type is shown fixed, with the reason. Every setting a form stores is kept through an edit, and Move up, Move down, drag, Duplicate and the refusal to delete a referenced field are unchanged. `AddFieldDialog` and `FieldEditor` are no longer exported from `@nextlyhq/plugin-form-builder/admin`: they were the builder's own parts, and the shared `FieldPicker` and `FieldSettingsPanel` from `@nextlyhq/plugin-sdk/admin` replace them.
