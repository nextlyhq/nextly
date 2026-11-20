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

Repeaters, groups and components keep one structure across languages:

- A repeater's or group's rows, their order and their shared values are the same in every language, and the text inside each row is translated on its own, kept with its row by the row's id. Reordering, adding or removing a row in any language applies to every language, and a removed row's translations go with it. A component placed in a container's rows is translated with its row.
- `localized: true` on a repeater, a group or a component field is refused when the configuration loads (`FIELD_STRUCTURE_NOT_TRANSLATABLE`): mark the fields inside instead.
- In a held change, a structure change is the shared part's and goes live with any language's publish; a text change inside a row, or inside a component's instance, is the language's own.
- `nextly migrate` converts content an earlier release kept whole per language where every language has the default language's structure, refuses and names each document whose languages differ (the dry run lists them too), takes the flag off the Schema Builder's definitions, and splits pending changes holding such a field by part.
- The editor tells a container whose rows hold translated text apart from a shared field, fills a text inside a row from the same row of the source language, and copying from another language copies the text inside rows onto this language's own rows.
