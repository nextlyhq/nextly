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

A plugin's Singles and field groups, and the collections under its legacy `collections` key, are recorded as the plugin's (`plugin:<name>`) by a start, a configuration reload and `nextly db:sync`, and by `nextly migrate` for a row it creates. They were recorded as the app's own, so once the plugin left the configuration `nextly db:sync --remove-orphaned` listed them as the app's removed ones and, with the data-loss consent, deleted their tables and rows.

- `db:sync` now keeps them, `--remove-orphaned` included, and names each with its plugin. `nextly prune` removes a departed plugin's collections, as before; it does not take Singles and field groups yet.
- A row already recorded as the app's own is the plugin's again after one `db:sync`, development start or reload with the plugin configured. **If the plugin has already left your configuration, nothing says whose the row is**: `db:sync` still lists it, and `--remove-orphaned` would delete it. Put the plugin back, run `nextly db:sync` once, then remove it. A production database keeps what it records: its starts write no rows and `nextly migrate` moves no owner. A collection under the legacy key that you handed to the Schema Builder becomes the plugin's again, as one under `contributes` does.
- A departed plugin's Single takes writes, as a departed plugin's collection does. Before, they were refused as to a Single removed from code.
- **Data-loss consent:** a consent naming the main table of a plugin's Single or field group no longer covers its translation and junction tables. Name each, as for a plugin's collection.
- **Types:** `source` on a Single and on a field group can be `plugin:<name>`, in the Direct API too, as a collection's can. An exhaustive `switch` on it gets a new case.
- The lists of Singles and field groups in the admin name the plugin as the source.
- A plugin's Single stays among the site's content types, so its public address and its place in SEO are as they were. A collection under the legacy `collections` key leaves them, as one under `contributes` is not among them: its pages leave the SEO listing and the addresses they held are free.
- A departed plugin's Single is still no page the page builder opens, so its former editors gain nothing.
- **Also fixed, whoever owns the row:** a configuration reload added the translated columns of a field group or a Schema Builder Single that is not in the configuration to its main table. It leaves them in the translations table.
