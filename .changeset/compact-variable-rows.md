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

Each variable in the Design panel is now one compact row. A colour shows one
swatch, split corner to corner where its dark value differs, light at the top
left and dark at the bottom right. Its name follows, then a ⋯ button. The
second and third swatches, the count at the end of the row and the "Light /
Dark" hint are gone. How widely a variable is used is said in the row's
tooltip ("Used in 14 places", "Not used", "Not counted yet") and in its name
to a screen reader.

The ⋯ menu offers four kinds of action:

- **Rename**, which edits the name in place in the row. F2 does the same.
  Enter or leaving the field keeps the name, and Escape cancels. The code name
  stays, so CSS that uses it keeps working.
- **Duplicate**, which adds "<name> copy" right below the original, with the
  same values, and opens it. A type size is copied with its line height.
- **Add dark value**, on colours and shadows, or **Remove dark value** where
  a variable has one.
- **Remove**, which opens the variable's editor at its confirm, so the check
  of where it is used still runs. A variable the site's code supplies offers
  **Reset to built-in** instead.

Shift+F10 or the menu key opens the menu from the row. The rules that decide
what Remove and Reset act on moved into their own module, shared by the menu
and the editor.
