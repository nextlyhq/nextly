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

The page's Layout picker:

- **Draft warning under row rules:** it warns of draft changes on a Layout, or a region's component, whenever the author may see that row's working draft, which is the case when they may update or publish it, including under a row-filtered rule. An author who may do neither is still told nothing.
- **Failed draft reads:** a draft read that fails for any reason other than access now fails the request, so the picker offers "Try again" rather than silently dropping the warning.
- **Searching a long list:** a search lists only the Layouts whose title matches, so a search with no matches says "No Layouts match".

On a page drawn inside its Layout, the part that emits the site sheet is now scoped like the others when a route states only the site's styles. Its rules no longer reach the page's or the footer's.

`@nextlyhq/blocks-react` also re-exports the engine types `OpPosition` and `Placed`, which types it already exports refer to.
