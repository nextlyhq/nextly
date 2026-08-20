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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch

A surface that needs to edit this site's rich text outside the admin's own field — the page builder's
canvas is the first — can now load the same node classes and theme the field editor registers, through
`loadRichTextEditorKit()` on `@nextlyhq/plugin-sdk/admin`.

Sharing the registry is the point. Lexical recognises content by the identity of the classes that
wrote it, so an editor built on a different set reads existing rich text as plain text — silently, at
read time, on documents that already saved.

The loader is async because the node classes carry Lexical and PrismJS with them, a 630KB chunk the
admin deliberately keeps behind a dynamic import. Awaiting it is what keeps that weight away from
consumers who never open an editor.
