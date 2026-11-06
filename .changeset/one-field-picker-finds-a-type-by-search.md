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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
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
---

The Schema Builder's field picker is now one shared picker. It opens on its search box and shows a short "Most used" group, then the categories. Search matches a type's name, description, category and the words people use for it, so "relationship" finds Link to entries, "repeater" finds Repeating rows and "image" finds Image or file. It works by keyboard alone: arrows move, Enter picks, Escape closes. Picking a type asks only for a label, shows the name it derives, adds the field where the picker was opened (the end of the list, or inside the group or repeater it was opened from) and opens it for editing. "Add and add another" returns to the search for the next one. Picking Field group lists the existing field groups by name and address.

`@nextlyhq/plugin-sdk/admin` adds `FieldPicker` with its `FieldPickerConfig`, `FieldPickerChoice`, `FieldGroupOption` and `FieldPickerProps` types, plus `describeFieldTypes` and `FieldTypeDescription`. All are `@experimental`. `nextly/field-catalog` adds `describeFieldTypes`, `FieldTypeDescription`, `MOST_USED_FIELD_TYPES` and `FIELD_TYPE_CATEGORY_ORDER`. The existing field-UI exports, `FieldTypePicker` among them, are unchanged.
