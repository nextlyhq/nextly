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

The Schema Builder edits a field in one settings panel, docked beside the field list (a sheet on a narrow screen). It is the same panel for a field just added and one that already existed, with five tabs: General, Validation, Display, Conditions and Advanced. The settings that make a field its type come first in General: a dropdown's options, a link's collection, a field group's choice, an upload's files, a Blocks field's accepted blocks. Width is in General and offers every stored width (25, 33, 50, 66, 75 and 100 per cent), and each field shows the path the API returns it by, such as `authors[].social[].url`.

There is no Apply step any more: each change is kept in the Builder's unsaved changes the moment it is made, so switching to another field keeps it, and Save works as before. Deleting a field from the panel still asks first.

A saved field's name no longer follows its label. Relabelling "Summary" as "Excerpt" used to rename the column and ask at save whether to rename or drop it; now the name, the column and the API key stay as they are, and the save has no schema change to review. A field added since the last save still takes its name from its label.

Fixes in the same panel:

- A Blocks field has settings: the blocks it accepts and the kinds of document it holds, typed as names (such as `core/*`).
- A field of a plugin's type always shows the settings every field has, and says it has none of its own.
- Changing a Blocks field's accepted blocks, or a plugin type's own options, now counts as an unsaved change, so Save is enabled.
- Switching a field-group field between Single and Dynamic zone now changes it; before, the second of its two writes undid the first.
- The type editors' switches, inputs and choices now have accessible names, and the chosen layout, appearance or mode is announced as chosen.

`@nextlyhq/plugin-sdk/admin` adds `FieldSettingsPanel` with `FieldSettingsPanelProps`, `FieldSettingsSurface`, `FieldSettingsField`, `FieldSettingsControlProps`, `FieldSettingsSurfaceControlProps`, `FieldSettingsTab`, `FieldTypeSettings` and `FixedFieldSetting`, all `@experimental`. A surface configures the panel (its plugin types, how a label becomes a name, the settings it fixes and why, its own settings by tab, its conditions) and stores each change itself; the panel writes nothing. The existing field-UI exports are unchanged.
