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

The entry list now draws what plugins add to it (experimental).

- Blocks stand around the list's own header and list, the place's built-ins `toolbar` and `table`, in the order sent, each behind its own error boundary.
- Declared columns are drawn after the collection's own, always shown and not offered in the column chooser.
  - A `field` column draws through that field's own cell. It names a field at the collection's top level; one inside a group or repeater is not drawn.
  - A component column draws one cell at a time, each cell behind its own boundary. A click or key on a control inside a cell stays in the cell rather than opening the row's entry.
- Declared bulk actions are offered in the bar shown while rows are selected, when the action's `visibleWhen` holds for every selected row, and run on the selected rows. Rows can be selected for a declared bulk action even where no built-in bulk action is allowed. An action is held back, saying why, on more rows than one request to its route may name.
- Row and bulk actions share one filter for the collections they're offered on and one way of running.
- `nextly/config` exports `MAX_ACTION_ROWS` (experimental), the most rows one request to a declared action's route may name.
