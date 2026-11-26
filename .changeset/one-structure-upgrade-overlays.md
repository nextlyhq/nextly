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

Repeaters and groups that keep their text per language, on an upgraded site:

- A translations column's default-language seed fills only an overlay not yet written. Planned again by `migrate:create` where the column already stands (an upgraded site whose newest snapshot records no overlay columns), it no longer replaces the text editors have saved with the bare structure.
- `nextly migrate`, and a start that runs migrations, make a Schema Builder collection's, Single's or field group's missing overlay columns and seed them, as they do for the entities in code. An upgraded site's Builder collection with a repeater holding text no longer reads as not migrated in every language.
- **Storage decision:** a required repeater or group keeping one structure on a translated entity has a nullable column on its main table; `required` is enforced when a document is saved, as for a translated field. A site with such a field gets one migration making that column nullable. A required container an earlier release translated whole, its flag removed, now completes `migrate:create` and `nextly migrate`, and its content reads in every language.
- A Schema Builder change making a shared field inside a repeater or group translated is refused for now, naming the field: the value each entry holds there is every language's, and the first save in one language would take it.
- The refusal of a translated text inside a repeater or group becoming an untranslated type applies only where that text is kept per language: no longer on a site laid out before per-language storage, for a text a group inside marks shared, or for a row's own `id`.
