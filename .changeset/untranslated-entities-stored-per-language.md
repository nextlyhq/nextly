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

Under `experimental.perLanguageStorage`, every remaining path that asked whether an entity is translated where it meant "where are its values stored" now follows where they are stored. An untranslated collection, Single or component keeps its translatable values in its per-language table everywhere: Schema Builder saves and the translation toggle, the dev build and reloads, `migrate:create`, boot, restoring a version, column repair, previews, version history, publishing, and plugin fields extended onto Builder entities.

Turning translation on for an entity on such a site adds a per-language publish state, seeded from the entry's state in every language. Turning it off removes that state, and is refused with a conflict while any language's publish state differs from its entry's.

With the setting off, nothing changes.
