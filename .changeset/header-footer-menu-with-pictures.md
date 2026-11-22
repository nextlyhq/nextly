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

A page now picks its header and footer from one "Header & footer" menu with pictures. Each item shows a small picture of the set, its header above its footer, drawn from the published set, with its name and a note: "Site default (<name>)" with "Follows the site if the default changes", each other set with "Header and footer", "Header only" or "Footer only" (or "Not published: …"), and "None" with "No header or footer", then "Manage headers & footers ↗". The same menu sits in the builder's Settings, its page settings panel and on the entry page, and is searchable above ten sets. The header & footer choices route answers each set's `areasFilled` in place of `isEmpty`, and sends every listed set's published definitions when asked with `?pictures=1`.
