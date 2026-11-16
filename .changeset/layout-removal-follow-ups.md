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

Page Builder: Remove Layout reads past a page deleted while it runs. A page deleted after a removal listed it no longer stops the removal's scan of the pages using the Layout, or the clearing of the other pages left on it afterwards; a page is read past only once a second check confirms it is gone. A page that is still there but can't be read refuses the removal with "Not every page could be checked", and any other failure still stops it.

The default Layout repair, at startup and in its background job, now finishes a restore of a deleted default that stopped after creating the restored Layout, pointing the default at it, before it would fall back to the seed Layout. The restored Layout is no longer left behind unused. If that Layout was deleted or unpublished in the meantime, up to the moment the default is written, the repair falls back to the seed as before.

The check Remove Layout makes after its write, which clears pages a save in flight left on the Layout, is now tried again by the background job when a page it reached could not be read, keeping the removal open until then. A check that reaches its 2,000-page limit still finishes, with a warning in the log; a page past the limit still left on the Layout uses the site's default Layout.
