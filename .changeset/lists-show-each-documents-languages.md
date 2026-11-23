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

On a site with more than one language, a collection list shows each document's languages as labelled chips (live, changes, out of date, draft, missing), with a key above the table, in place of the language dots. Each chip names its language by code and its state in words, and opens the document in that language. The list filters by "Missing in <language>" and "Out of date in <language>" (the `_translated` filter's `missing` and `stale` states, kept in the address as `?pf=nextly.language:<state>.<code>` like the other list filters), and replaces "Translated in". Where the title is translated, a "Titles in" control shows titles in a chosen language, read in that language alone with no fallback: a row with no title there keeps its default-language title, marked as such, and each title carries its language's `lang` and `dir`. The chips and the filter are offered only to a reader who may read every language's state; a site with one language shows none of it.
