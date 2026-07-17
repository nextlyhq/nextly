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

Plugin-contributed field types now appear in the admin field pickers.

A plugin that contributes a custom field type can opt it into any admin surface — the Schema Builder (collections and singles), the User Fields page, and the Form Builder — via `contributes.fieldTypes[].surfaces`, and give it a picker label, hint, icon, and category. The type then shows up in that surface's field picker, surface-filtered, and works end to end: it is accepted by the surface's validation, persists as its declared storage primitive (a user field gets a real column of the right type instead of a text fallback), and renders through its own admin component. Plugin authors get a shared, storage-agnostic field-UI kit for this via `@nextlyhq/plugin-sdk/admin` (`FieldTypePicker`, `FieldOptionsEditor`, `withOptionIds`, `FieldDefaultValueInput`, and the new `usePluginFieldTypeEntries` hook), plus `isPluginFieldTypeOnSurface` for server-side validation.
