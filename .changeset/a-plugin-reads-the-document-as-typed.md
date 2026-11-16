---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

A plugin's component inside an edit page can read the document as it is being typed, and write a field (experimental).

- `useDocumentValues(paths)` answers the named fields of the document being edited, by their dot paths, before any save, and draws again only when one of them changes.
- `useDocumentField(path)` answers one field's value, whether it may be written now, and `set(next)`, which writes as the author typing would and marks the document changed. While the document's content is held (a past version on screen, a colleague editing it, a page the reader may only read), `set` writes nothing and answers `false`. `set(null)` returns a field to its automatic value.
- Both work in any component a plugin draws inside an edit page, on an entry, a new one or a Single. They read the editor's own form, so a component with a form of its own still reads the document. Outside an editor they answer `null`.
- Exported from `@nextlyhq/plugin-sdk/admin` with `DocumentField`.
