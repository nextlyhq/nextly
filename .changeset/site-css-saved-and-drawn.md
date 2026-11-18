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

Custom CSS for the whole site (experimental).

- **Stored and saved.** The site's CSS is kept in the page builder's own options table and
  saved through the site code routes (`GET`/`POST /site/css`), under the site settings
  permission, by a signed-in person only: an API key is refused. The server checks it with
  the one custom CSS checker and names each refused line. A save made from CSS someone has
  changed since is refused: "Someone changed the site CSS; reload to see it". Each save writes
  an audit row (who, when, size and SHA-256 before and after, never the CSS) and refreshes
  every cached published page. The site's CSS has no version history yet: a save replaces it.
- **Drawn first.** `pageBuilderCustomCss({ plugin })` reads the site's CSS through the page
  builder the route names, and draws it before the page's and the blocks'. Without `plugin`,
  the route draws the page's and the blocks' CSS only. The canvas draws it too.
- **`CustomCssSource.tags`** (`@nextlyhq/blocks-react/next`): cache tags of other data the
  site's CSS read consults, beside `singles`, so a plugin's own cache expiry refreshes the page.
