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

A plugin can contribute a full-screen view of a document, at its own address
under the document's: `/admin/collections/<slug>/<id>/<path>`, or
`/admin/singles/<slug>/<path>` for a Single. The admin keeps the document's
loading, soft lock, recovered-work offer, leave guard and save shortcut around
the view, so the plugin implements none of them. Declare a view for one
collection under `contributes.admin.views[slug].documentViews`, or for every
collection and Single with a top-level field of a type the plugin contributes
under `contributes.admin.documentViews` with `fieldType`. `navigateTo` in
`@nextlyhq/plugin-sdk/admin` moves to another admin page and refuses any other
address. `PluginDocumentView`, `PluginFieldTypeDocumentView`,
`DocumentViewProps` and `navigateTo` are experimental. Startup is refused when a
view's path is malformed, reserved (`versions`, `api`), claimed twice on one
document, or offered on a field type its plugin does not contribute.

`nextly generate:types` now writes the plugin component import map, or removes a
stale one, in an app that defines no schema in code. Such an app, whose schema
is made in the Schema Builder, rendered empty plugin pages and settings
components in a bundled admin, because the map was skipped with the types.
