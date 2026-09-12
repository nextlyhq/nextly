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

A plugin can contribute a dashboard-widget DATA SOURCE. `contributes.widgetSources`
takes a source and the server-side function that answers it, together: the
source declares its queryable fields and supported ops the way every other
source does, and the resolver is handed `(query, caller)` and nothing else.
Because the query was validated against that declared field list first, no
string the caller wrote reaches the resolver as a URL, a path or a table name.

Both halves travel in one value, so a source that nothing can answer is not a
state a plugin can reach. A contributed id must sit in the `plugin:` namespace;
`collection:`, `single:` and `system:` are refused at boot, as is a duplicate id
or a missing resolver, each naming the plugin that declared it. A disabled
plugin contributes nothing, and a boot starts from an empty store, so a source
never outlives the plugin that published it.

The dashboard query endpoint now bounds each slot. The batch answers with
`Promise.all`, so it was only ever as fast as its slowest query: one that never
settled held every other card behind it and the reader saw nothing at all. A
slot that exceeds its budget now fails on its own and its siblings still answer.

`WidgetSourceResolver`, `PluginWidgetSource` and `ReadCaller` are published from
`@nextlyhq/plugin-sdk`, so a resolver can be written as a named function rather
than only inline. They are `@experimental` on the same ladder as the rest of the
widget contract.
