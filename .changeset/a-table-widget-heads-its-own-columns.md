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
"@nextlyhq/plugin-form-builder": patch
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

The `table` archetype is drawn by the host. A plugin declares a table widget with no UI code of its own:

```ts
{
  id: "acme/posts",
  title: "Recent posts",
  archetype: "table",
  defaultSize: "lg",
  query: {
    source: "collection:posts",
    op: "list",
    select: ["title", "publishedAt"],
    limit: 5,
  },
}
```

Each column is headed by that field's label from the collection, so a heading reads "Published at" rather than `publishedAt` — the same string the entry form puts above the field, agreeing by construction rather than through a second declaration that could drift. Where a source has no label the field name is used, which is a poor heading but a true one.

The columns come from what the SERVER returned, not from `select`, and that is the difference that matters. A field carrying an `access.read` rule denying the viewer is stripped from every row before selection runs, so heading the table from the declaration would draw a column no row can fill and print the label of a field this reader may not see. Rows that arrive with no column descriptions are refused by name rather than falling back to `select`, because that fallback is exactly the one that would undo the server's filtering.

A table that selects nothing says so without running a query, an empty result says "Nothing yet." instead of drawing an empty table, and a card shows at most five rows with the footer link as the way to the rest. A cell holding an object is left blank rather than rendered as "[object Object]"; `0` and `false` are printed, since only null, undefined and blank are absences.

The cell reading shared with `list` now lives in one module, so "what does this cell say" has one answer rather than two that drift the first time either is corrected.
