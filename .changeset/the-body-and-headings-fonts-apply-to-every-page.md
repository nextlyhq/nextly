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

Pick the site's Body and Headings fonts at the top of Design → Type, and every page uses them: on the canvas, on the editor's own blank page, and on the published site, header and footer included. Each picker lists the site's fonts, the system's fonts and "Your site's own font"; Headings starts as "Same as body". A site font falls back to a font of its own kind (serif, sans-serif or monospace) while it loads. A block, a text style or a style that sets its own font still wins.

Until you pick one, nothing is written for body text, so a host's own font keeps working on new and upgraded sites. The fonts are the variables `font.body` and the new built-in `font.heading`, so a host's own CSS can read `var(--site-font-body)` and `var(--site-font-heading)`. When the Headings font has no Bold, the panel says so, with "Add Bold" for a font from the catalogue.

For developers: a Site text row (`SiteTokenSet.siteText`) now also holds `fontFamily`, on every row but Links; the Body font is `body.fontFamily` set to `{ $token: "font.body" }`. The editor's blank canvas no longer reads `font.body` on its own: the page's Body row writes the font on the page root on every surface. Every compiled site sheet now declares `--site-font-heading` (`system-ui` until it is set).
