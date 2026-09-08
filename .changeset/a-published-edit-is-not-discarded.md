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

Publishing every language no longer discards a translation that was waiting to
go live.

A document that exists in one language only — German, say — keeps its other
translations in a pending state until someone publishes them. Saving English
text against such a document stores it as a pending edit, and publishing every
language should carry that edit live along with everything else.

It did not. The publish loaded the pending edit and folded it into the write,
then declined to write the translation row, then deleted the edit as though it
had been applied. The English text became unreachable from every read — the
public view, the editor's view, and the pending queue alike — while the call
reported success. Only a version-history snapshot retained it, recoverable by a
manual restore that nothing prompted anyone to perform.

Publishing every language deliberately does not invent a translation for a
language nobody has written; that remains true. An edit an author typed and
saved is not an invention, so it now lands where it was going, and the document
reads back with the text that was published. Both collections and Singles were
affected and both are fixed.
