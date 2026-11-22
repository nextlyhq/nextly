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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

A "Text style" picker at the top of every block's Style › Text section lists the site's text styles, each previewed in its own look, and None. Picking one gives the block the whole look, so a heading can look like "Display" and a paragraph like "Eyebrow"; a block wears one text style at a time, held in its class list beside its block style and shared style, so a stored page keeps the shape it has.

- A block's own typography value over its text style reads "Changed from Eyebrow", with Reset, which shows the text style's value again.
- A value a block takes from its text style says "From text style: Eyebrow". The style trace's class origin carries `role: "text"` for a text style (`@experimental`), so any reader of the trace can say the same.
- Text styles are no longer listed among the shared styles: the Styles tab's Shared styles list, "Apply a shared style…" and the shared-style chips in the Style tab's bar leave them out, and a block wearing a text style can still wear a shared style.
- `StyleInspectorPanel` takes an optional `classLibrary`, which the "Text style" picker lists from; without it no picker is drawn.
