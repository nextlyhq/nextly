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

Page settings in the builder gains a **Code** tab, last in the row, for people who may change the site's settings: a Head and an End of body box for code added to that page only, checked and explained exactly as Site code is (what can't be stored is named and nothing is kept; what the site's security policy would block is shown, and kept only once the person says they understand). The code is kept in the page's own document (`settings.code`), so it is saved in the draft on Save, goes live on Publish, is kept in the page's history and comes back when an older version is restored. Anyone else sees one line on General saying the page adds its own code, never the code.

The server judges a page's code on every write that changes it: it refuses the change from anyone without the site settings permission and from any API key, refuses what the site code rules can't store, and keeps code the site's declared policy would block only where those findings were acknowledged. Each committed change writes an audit row with hashes, sizes and counts, never the code. `<PageCode>` from `@nextlyhq/plugin-page-builder/site` renders it on a published page, guarded as `<SiteCode>` is.

New, `@experimental`: a `code` op in `@nextlyhq/blocks-engine` (one undoable edit of `settings.code`, held as the `seo` op is), and `PluginFieldWrite.caller` in Nextly and the plugin SDK, which tells a plugin field type's validator who the write is made as (a user, an API key, a person, a visitor or trusted code) and whether they may perform an action, by the same decision a plugin route's `ctx.caller.can` makes.
