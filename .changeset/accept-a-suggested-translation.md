---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

A translated document's texts can be listed and their suggested translations accepted or dismissed, one text at a time, inside repeaters and groups too (`@experimental`):

- The units of a document in one language: `GET .../translation-units?locale=` of an entry or a Single, or `nextly.translations.units`. Each has its value, whether you may change it, the languages it may be translated from with the text each holds, and the suggestion open for it.
- Accepting a suggestion, as it is or with your own text: `POST .../suggestions/{suggestionId}/accept`, or `nextly.translations.acceptSuggestion`. It saves as your own save of that language would and records where the text came from, so a source changed since the suggestion was made reads as out of date. Only a signed-in person may accept, and a field they may not change is refused.
- Dismissing one: `POST .../suggestions/{suggestionId}/dismiss`, or `nextly.translations.dismissSuggestion`.
- A save may say which language a value was translated from: `_provenance: { title: { origin: "translated", sourceLocale: "es" } }`, with the `sourceFingerprint` the translator saw. A source that is not published, has no text of its own, is not known to be up to date or that you may not read is refused.
- `translations.sourceChange` gives no `valueFingerprint` for a translation saved as it is read, so "Keep current" never takes one for a value you were not shown.
- Each text inside a repeater or group is recorded, and found out of date, on its own.

Suggestions are kept in a new table, `nextly_translation_suggestions`, which `nextly migrate` creates. Nothing in this release makes suggestions yet.
