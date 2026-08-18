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
---

The entry editor's language tools are now visible, reachable, and legible.

In a localized collection, the document title was invisible: the language strip shared its header row and squeezed the title input to zero width at every screen size. The title now has its own row, with languages on a row of their own beneath it.

One segmented control shows every language with its state (published, translated, draft, or not translated — carried by shape and text, never colour alone) and switches between them; it replaces the separate dropdown and pill row that both switched languages. A Languages menu in the header offers Copy from and Publish all languages at every screen width — previously those lived only in a side panel that disappears on smaller screens — along with a legend for the language states.

Creating an entry now says which language it will be created in. The "Shared across languages" badge appears only while editing a non-default language, where it matters. If a language fails to load, the editor offers the way back to the default language instead of only an exit.
