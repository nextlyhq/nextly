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

`nextly repair-columns` now says whether each differing column can convert, from the rows it holds: safe (every value converts and reads back the same), lossy (some values cannot be held by the new type and would be cleared) or blocked (a value would be cut, changed or invented, or there is no conversion for the pair). Every reason is named with the rows that give it, by id or, in a translation table, by parent and locale; stored values are never printed. Each value is judged as that database would store it: on MySQL a 64-bit integer becoming a double is blocked, because a value written while the conversion runs could be changed with no error. The development push's check before renaming a legacy column into JSON, or converting a component's many-to-many into a list, now uses the same judgement. The command still changes nothing.
