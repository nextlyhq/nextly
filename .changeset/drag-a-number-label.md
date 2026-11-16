---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

Change a number field in the Style panel by dragging its label.

- Drag a number field's label left or right to change its value. Shift moves it in
  steps of ten and Alt in tenths. The field shows the value as it changes, and
  letting go writes it once, so one Undo takes back the whole drag. Escape during
  a drag puts the value back.
- The label shows a resize cursor. A click on it still focuses the field, and on
  a touch screen a tap focuses the field without dragging.
- The arrow keys in a number field now step by a tenth with Alt, as a drag does.
- The canvas's spacing handles and the field labels now share one drag gesture,
  so both start a drag at the same distance and handle Escape the same way.
