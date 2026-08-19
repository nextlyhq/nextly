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

Translating a document now shows the source language beside the one being edited. A translator working a non-default language could previously see the source only as an inline hint under each field, and that hint could render a string or a number and nothing else — so a richText body, a relationship or a chips list had no source text on screen at all, silently. The new mode renders the source through the editor's own field components, so whatever a field can draw the source shows.

The language pair lives in the URL (`?locale=es&translate=en`), which makes it linkable, reload-safe and reachable with the back button, and makes entering or leaving it a navigation the unsaved-changes guard can see. While the mode is on the admin's navigation, sub-sidebar, header and page frame step aside, and the mode renders its own way back — the suppression layer grants the navigation rail only to a surface that says it can be left.

The source pane is read-only and shows only the translatable fields: a shared field holds the same value in both languages, so putting it there would fill half the screen with a copy of what is already in the other pane.
