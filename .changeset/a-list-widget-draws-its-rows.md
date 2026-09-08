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

The `list` archetype is drawn by the host. A plugin can declare a list widget with no UI code of its own:

```ts
{
  id: "acme/recent",
  title: "Recent posts",
  archetype: "list",
  defaultSize: "md",
  query: {
    source: "collection:posts",
    op: "list",
    select: ["title", "slug"],
    limit: 5,
  },
}
```

Which field each row shows is taken from the query's `select`, in order: the first selected field is the row's label, and the second — where there is one — is the muted line beneath it. Derived from `select` rather than declared again, because the author has already said which fields the widget is about and a second declaration could disagree with it; it also means a card cannot display a field it never asked the server for.

A `list` whose query selects nothing is refused by name in its own card rather than guessed at. Without `select` the rows carry whatever the collection happens to hold, so core would be picking a key out of a document it knows nothing about — and the key it picked would change the day someone added a column.

A cell that is not printable is left out rather than stringified. A relationship, a repeater or a localized value arrives as an object, and `String(value)` renders "[object Object]", which reads as data rather than as a defect; the row still holds its place so the number of rows matches the number of results. `0` and `false` are printed, since only `null`, `undefined` and blank strings are absences. An empty result says so instead of drawing an empty list, and a card shows at most five rows.
