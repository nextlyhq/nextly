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

The page builder's **Settings** is now a dialog with two tabs. **This page** holds the entry's own fields and a preview of how a shared link looks, built as the published page's metadata is. **Site** holds the site's breakpoints and its default Layout, and applies to the live site at once. It is offered only to a role that may manage the page builder's site settings. Breakpoints move there from the top bar: they are listed in the device buttons' words and edited in place, the whole set saved at once. Enter in a Settings field never saves the page, and closing Settings over an open breakpoint edit asks first.

The site's breakpoints now change through one route, guarded by the `manage-page-builder-site` permission, and a write to the `site-style` Single that changes them any other way is refused with a 403. This includes the REST API and the Single's own form, even for a role holding both permissions. A role with the site permission alone can change breakpoints; a role with Design's alone cannot. Writes that change only tokens, fonts or classes are unaffected.

`@nextlyhq/plugin-sdk/admin` adds `writePluginRoute` (experimental): a one-shot write to a plugin's own route that rejects with the parsed error.
