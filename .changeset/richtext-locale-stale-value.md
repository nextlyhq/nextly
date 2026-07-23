---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

The rich text editor now follows content-language switches and version restores.

Lexical reads its initial state once at mount, so when a localized entry or single switched language the form fetched and reset the other language's values, every regular input followed, and the editor kept displaying the first-loaded language. Stored translations were correct in the database, but the editor showed the default language for every locale, and saving from that stale screen overwrote the open locale's translation with the displayed content.

A sync plugin now loads external form-value changes into the editor: a language switch or version restore replaces the editor content, an untranslated language shows an empty document, and the editor's own keystrokes echoing back through the form are recognized and left alone so the caret never jumps while typing. The undo history is cleared on each external load so undo cannot resurrect the previous language's document into the current one.
