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

Plugins can now build field-editing UI from the same components the admin uses.

**New in `@nextlyhq/plugin-sdk/admin` (experimental): the field-UI kit.** Three controlled, form-library-agnostic components, following the same author surface as the shared DataTable:

- **`FieldTypePicker`** — a grid of type cards rendered from `nextly/field-catalog`, narrowed to your surface's allowed types, with the same label, hint, and icon for a type everywhere it appears.
- **`FieldOptionsEditor`** — the schema builder's options editor: label/value rows with drag reorder, values auto-generated from labels until edited, CSV/JSON import, and select/radio display knobs.
- **`FieldDefaultValueInput`** — a type-aware default control: checkbox defaults are a true/false choice, select/radio defaults choose among the field's own options, number and date get typed inputs.

**The options editor now reports every duplicate value at once.** Previously a batch of colliding option values surfaced one collision at a time — fix one, resubmit, discover the next. All duplicated values are now named together in a single warning.
