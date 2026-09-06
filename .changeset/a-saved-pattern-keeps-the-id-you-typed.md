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

A pattern saved from the page had its DOM ids rewritten. A block whose `cssId`
an author typed as `hero` was stored as `hero-3ee4a0d4`, and that value is one
people read and write: it appears in a URL fragment, in a stylesheet and in the
attribute panel.

Rewriting them was never what saving needed. An id is remapped so that a copy
placed BESIDE its original does not emit the same HTML `id` twice — and a
saved run is not placed beside anything, it becomes a document of its own.
Inserting the pattern remaps it then, which is where the collision can actually
happen.

Doing it at save had two further costs. Saving one selection twice produced two
different documents, so anything fingerprinting a pattern's content reported a
change nobody made. And the suffixes accumulated: saving, inserting and saving
the copy back grew the id by nine characters each time round, with no bound.

Saving a selection over an existing pattern is now planned as well, so a
library does not fill up with `hero-v2` and `hero-v2-final`. It replaces the
pattern's content and leaves the row's own name and description alone, and it
brings the run it was saved from back into sync — without it, blocks that had
just defined a pattern would report themselves out of date against it.
