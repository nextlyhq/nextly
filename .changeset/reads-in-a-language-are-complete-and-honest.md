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

Reads in a language are complete and honest.

- A public read in a language a document isn't published in answers not found, and a list leaves the document out. Asked for (`?fallback=document`, Direct API `wholeDocumentFallback`), a read of one document answers in the first language of its fallback chain that it is published in, and says which (`_locale`). Collections and Singles alike.
- A translatable unique field (a slug) is read in the requested language only: it never falls back to another language's value.
- `?source-locales=1` (Direct API `sourceLocales`) adds `_sources`: the language each translatable value was read in, or `null` where no language holds one.
- `?translations=all` (Direct API `translations: "all"`) adds `_allLocales`: each translatable field's value in every language, beside the row's own fields in the language read. Both side keys say only what the read does: a field a read rule or a hidden-field strip withholds from the row is withheld from them too.

Breaking changes:

- A public read in a language the document isn't published in answers 404 instead of falling back field by field.
- A list read asked for `?fallback=document` is refused with 400: whole-document fallback applies to a read of one document.
- Under the alias, `locale=all` reads, searches and sorts in the default language and adds `_allLocales`.
