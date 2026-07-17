---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

The form-builder plugin no longer ships a second, unused field-builder UI.

The package contained a complete parallel implementation of the field builder (a field-type registry, eight per-type editor components, an options editor, and the AddFieldButton/FormFieldList/SortableFieldRow/FieldEditorPanel components) that no screen ever rendered — the live builder uses its own components. These were still exported from the package, so they showed up in editor autocomplete and typed API surface as if they were supported. They are now removed.

If you imported any of these directly from `@nextlyhq/plugin-form-builder/admin` (FormFieldList, SortableFieldRow, AddFieldButton, FieldEditorPanel, or the per-type field editors), those exports are gone; the supported builder components (FieldLibrary, FormCanvas, FieldEditor, FormPreview, ConditionalLogicEditor) are unchanged.
