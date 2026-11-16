---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

The form builder's fields are one outline, with the selected field's settings docked at the window's edge.

- **One row per field**: its label, its type and stored name, and badges for what you would otherwise open it to see (Required, a width other than full, "Shown if…" with the fields its condition reads, and its default, by the choice's label).
- **The settings panel docks** as a column against the window's right edge, as tall as the window, from 1024px wide; below that it opens under the row.
- **Add a field where it belongs**: from the toolbar, from "Add here" between two rows, or with "/" on a row, which adds it below.
- **A saved field's name is fixed**, with the reason, as its type already was: its answers are stored under it.
- A rename finished after visiting another page of the form still moves what refers to the field (conditions, notifications), even when the name was cleared on the way.
- Every submission's own stored values (submitted at, status, notes, IP address and browser) are named under the list.

For plugin authors: `FieldCards`' `onAddField` callback gains an optional third argument, the place in the list a field was asked for; `generateFieldName` now lives in its own module and is still exported from the same place.
