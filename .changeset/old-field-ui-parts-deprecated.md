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

The field-UI parts `@nextlyhq/plugin-sdk/admin` has exported for building field editors are deprecated, each naming what replaces it:

- `FieldTypePicker` and `FieldTypePickerProps`: use `FieldPicker`.
- `usePluginFieldTypeEntries`: use `FieldPicker`, whose `config.surface` joins that surface's plugin field types to the picker.
- `FieldOptionsEditor`, `withOptionIds`, `FieldOption`, `FieldOptionsEditorProps`, `FieldDefaultValueInput`, `FieldDefaultValueInputProps`, `FieldDefaultOption`, `ConditionRow`, `ConditionRowProps`, `operatorsForType`, `operatorTakesValue`, `ConditionOperatorName`, `ConditionRange`, `ConditionSource`, `ConditionSourceOption`, `ConditionValue`, `ValidationNumberField`, `ValidationNumberFieldProps`, `ValidationRulesEditor`, `ValidationRulesEditorProps`, `ValidationRuleValues`, `drawsAnyValidationRule` and `EDITABLE_VALIDATION_RULES`: use `FieldSettingsPanel`.

They keep working unchanged, with the same props, until they are removed. Removed no earlier than 0.0.2-alpha.75, and only once the Form Builder and user custom fields use the shared picker and panel. The deprecation is in the published type declarations, so an editor marks each use; nothing is logged at run time.
