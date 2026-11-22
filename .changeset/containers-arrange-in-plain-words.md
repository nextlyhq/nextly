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

Containers arrange their blocks in plain words. Style › Layout now offers Arrange: Stack,
Row or Grid, with the CSS each writes shown small under it and on hover, in place of the
Display, Direction and Justify rows.

- Row offers Stack on, a 3×3 Align, Spread, Space between, Wrap onto new lines and
  Reverse order. A Row stacked on a device still reads as a Row there, and aligns by the
  column in force.
- Stack offers Align, Space between and Reverse order, and becomes a flex column only
  once one of them is set.
- Grid offers Columns, a number per device or as many as fit a minimum width, plus Rows,
  Align and Space between, which can set rows and columns apart.
- Values a change leaves without effect are kept and said ("1 setting from Row isn't used
  · Clear"); Clear removes them in one undoable step.
- A layout with no plain equivalent reads as Arrange: Custom with its CSS rows, and Use
  plain controls rewrites it.
