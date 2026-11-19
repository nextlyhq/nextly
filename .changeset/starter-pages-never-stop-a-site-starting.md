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

The page builder starts on any site, whatever its page limits. Its own starter
pages were judged at start-up against the site's `limits`, and one that didn't
fit stopped the server: a site allowing pages four levels deep could not start,
because the landing, about, contact and pricing starters nest five or six
levels.

Whether a site can use a starter page is now asked where starter pages are
listed and used:

- A starter the site can't use is listed, dimmed, as "Not available on this
  site" with why ("Needs 5 levels of nesting; this site allows 4.", "Uses the
  Form block, which this site doesn't have."), in the New page dialog and on
  an empty page. **Behaviour change:** a starter needing a block, a variable or
  a shared style the site doesn't have was left out of the list before; it is
  now listed as unavailable, so it never seems to vanish.
- A page made from it is refused with the same words, rather than "That
  starter page isn't offered here any more.", and applying it in the editor
  says why rather than doing nothing.
- The server log says once at start-up which of the page builder's own starter
  pages the site can't use, and why.
- `NewPageStarter` gains an optional `unavailable: { reason }`.

Every built-in starter fits within 6 levels, 100 blocks and 64 KB
(`BUILT_IN_STARTER_FLOOR`), held by a test. A starter page a site or a plugin
gives is still refused at start-up when it doesn't fit, as before.
