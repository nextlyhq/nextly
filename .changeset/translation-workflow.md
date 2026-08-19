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

Translation mode now reports progress and can fill a single field from the source. A translator sees how many of this language's fields are done, counted as they type rather than from what was last saved, and each translatable field offers "Use source" where the source has text — for the lines that are the same in both languages, a name, a URL, a product term. The document-level copy still exists for seeding a whole language; this is the grain the side-by-side view makes possible.

Also fixes two layout defects found by measuring rather than looking. The editor cancels its page container's padding with a negative margin, and inside a translation pane there was no padding to cancel — so its layout was 64px wider than the pane it sat in and the document rail was drawn past the right edge. And a language row in the 320px rail put its label, badges, state and two buttons on one unshrinkable line, which left an untranslated right-to-left language's "Open" button 38px outside the row, unreachable by pointer; that one was not new, and happened on the ordinary editor too.
