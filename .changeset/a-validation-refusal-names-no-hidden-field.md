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

A validation refusal no longer tells its caller about a field they may not read. A publish judges every stored value, so a refusal used to name a hidden field and say what was wrong with its value: "must be at most 10" told the caller the hidden value was over 10, "is required" that it was empty, and a field's own `validate` message could carry the value itself. Each issue on a field the caller may not read, or on a row inside one, now reaches them as one issue with no path, code `UNREADABLE_FIELD` and the message "A field you can't see doesn't pass validation." The write is still refused with a 400, and issues on the fields they may read are told as before. This holds for a collection entry and a Single, for a save, a publish of one language or of every language, the Direct API and a release's readiness check, and for the fields of a field group, whether held inside the document or saved as its own instance. A caller who may not read the entry at all is told no field of it, a password is never named, and where a field `afterRead` hook could change what a read rule decides, an issue on a field with a read rule is withheld. Trusted code (`overrideAccess: true`) is told every issue, and the server log records which paths were withheld, not their messages.
