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
---

Every link meant to open an entry (a list row, the row menu's Edit, a row's
language dots, the dashboard's Continue, Recent entries and Recent activity
cards, a release's documents and a media item's uses) now opens it
in one place, chosen by one rule. A collection can say where in code, with the
experimental `admin.opensIn` (`"form"`, or the path of a document view it
has), and a plugin's field-type view can ask to open first with the
experimental `opensFirst: "mainField"`, for collections whose main field (the
first top-level field that is not hidden, the title or `slug`) is of its type.
A reader who may not update the entry, or an entry opened in another language
than the default, still gets the form, and the form's own address keeps
working. A start, and every CLI command, refuses a collection that names a
view it does not have. Nothing changes for a collection that declares nothing
until a plugin asks to open first.
