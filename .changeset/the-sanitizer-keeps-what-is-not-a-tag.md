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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
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
---

Stripping HTML from a text value no longer deletes ordinary writing. A `<` opens a tag only when what follows it could name one, which is the HTML tokenizer's own rule, so `price < 100` and `2 < 3 and 5 > 4` are stored as written. This runs on every `text`, `string`, `textarea` and `email` field of every collection, and on media alt text, captions and tags, so an author lost the rest of a sentence on save with nothing to say why.

It is one pass, holding the invariant that a `<` it kept is never followed by a character that would open a tag. Removing a tag can put its neighbours together into a new one, and rescanning until the text stopped changing holds the same invariant at quadratic cost on a path every create and update reaches.

`stripHtmlTags` is published from `nextly`, beside the other security utilities a plugin already reaches for. A plugin storing text a visitor typed has to strip markup the way core does, and the absence of that export is why a second copy grew in `@nextlyhq/plugin-form-builder`. That copy is gone.
