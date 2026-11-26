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

The Schema Builder's type picker answers for a field inside a group or repeating rows as the save does. Where the save refuses a change there, the picker shows it unavailable in the save's own words: a translated text that would stop being translated, and a shared value that would become translated beside text kept per language. A shared value becoming translated where nothing of its collection, Single or field group is translated yet is shown unavailable by the picker, since the first save in one language would take the value from the others. A change that would have to rewrite every value held there, such as a number becoming text, is shown unavailable, since no save rewrites values inside a container yet, and one that would rewrite some may lose them. A number whose column holds an infinity is judged by it too, and a width no database makes a text column of is refused as the request's own error.
