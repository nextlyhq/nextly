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

Custom CSS for one page, and the server's checks on every save of page and block CSS
(experimental).

- **The page's CSS box.** Page settings → Code gains a **CSS** box above Head and End of body,
  for people who may change the site's settings: "CSS for this page only. Site-wide CSS lives
  in Site settings." **Check and keep CSS** checks it with the one custom CSS checker, naming
  each refused line, and keeps it in the page's document (`settings.customCss`) through a new
  engine op, `{ kind: "customCss", customCss }`, so it is drafted, published, kept in history
  and restored with the page. Anyone else sees General's line, now "This page adds its own
  code or CSS. …", and never the CSS.
- **Judged on every save.** The blocks field judges every write that adds or changes a
  document's own CSS or a block's: only someone with the site settings permission may, never
  an API key, and what the checker refuses is refused by line. Moving, duplicating and
  deleting blocks that have CSS, and placing a saved section that carries some, stays open to
  anyone who may edit the page. A draft-only save is compared with the draft alone.
- **Audited.** Each committed change writes a `document-css-saved` audit row: hashes and sizes
  of the document's and its blocks' CSS, before and after, and which document and field,
  never the CSS.
- **Page code after a dev reload.** A page's code is now judged with what the field type was
  built with, so a dev server's config reload keeps judging it rather than refusing every
  change until a restart.
