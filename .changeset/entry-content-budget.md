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

Entry content keeps every component placement whole under the page's limits.

- The room an entry's content may take is measured by the component resolver itself, on
  the page composed in full: the entry keeps the longest run of its blocks for which
  every component placement, the template's and the entry's own, resolves within the
  page's node and depth limits. A page that already fits is resolved once; only one
  past its limit is searched, by halving.
- In the editor, while the window's refresh reads the previewed entry again, its blocks
  and their conditions stay as they were until the Previewing strip names the refreshed
  entry, so they change together with the canvas's bound values. A change of collection,
  language or person is never taken for a refresh of the entry with the same id.
