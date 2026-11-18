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

Fixes to where translated values came from, and to the translation worklist:

- A plugin can no longer register a kind of signed-in person whose full name is too long to record. Every save by such a person was refused, because a document's history and its "last changed by" record keep a kind in at most 64 characters while registration allowed up to 191. Registration now takes its limit from the narrowest place a kind is stored, so a longer name stops the app at startup with the plugin named.
- A copy from another language says which version of its source it read (`sourceRevision`, the document's `_rev`). A copy whose source has changed since, or one that names no version, reads as out of date until it is copied or translated again. A copy from a language the site doesn't have, or into the language being written, is refused. The admin's copy menu sends the version.
- A field cleared in a translation no longer puts that language out of date. A text value that looks like JSON is compared as the text it is. A field or row named like an inherited object member (`constructor`) no longer breaks a save.
- Where values came from now follows a translated field's rename, is removed with a deleted collection or Single, covers a blocks field's nested nodes, is recorded for a Single's created defaults, and stays right when a held draft goes live (rows it removed, values it changed, values a publish gives).
- The translation worklist pages no deeper than it can read, says there is a next page only when there is one, names a Single whose document cannot be looked up as not consulted rather than failing, and names a Single that cannot answer staleness as unanswerable.
- In the admin, a copy is claimed only by a save of the form it was made in: switching document or language, or discarding, forgets it, and a copy made while a save is on its way is kept for the next save.
