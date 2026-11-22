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

Page settings in the builder gains a **Code** tab, last in the row, for people who may change the site's settings: a Head and an End of body box for code added to that page only, checked and explained exactly as Site code is (what can't be stored is named and nothing is kept; what the site's security policy would block is shown, and kept only once the person says they understand). The code is kept in the page's own document (`settings.code`), so it is saved in the draft on Save, goes live on Publish, is kept in the page's history and comes back when an older version is restored. Anyone else sees one line on General saying the page adds its own code, never the code. Only a page's own top-level Page Builder field keeps code: one inside a group, a list or a field group offers no Code tab, and the server refuses code there and on a collection template, a saved section or a component. A draft save is compared with the draft's code alone, so it can't put the published code back over it unasked.

The server judges a page's code on every write that changes it: it refuses the change from anyone without the site settings permission and from any API key, refuses what the site code rules can't store, and keeps code the site's declared policy would block only where those findings were acknowledged. Each committed change writes an audit row with hashes, sizes and counts, never the code. Published pages carry it wherever a route spreads `pageBuilderContent()`: the page's head code before the page and its end-of-body code after it, running after the site's code in each place (site head, page head, site end of body, page end of body), and never under draft mode. Its end-of-body code is started by a loader of its own, whose hash the Code tab names; existing site code and its policy hash are unchanged. `pageBuilderContent({ nonce })` takes the request's nonce for a nonce-only policy and gives it to both places. A page whose code starts scripts or styles is loaded, and left, as a whole document, so client-side navigation neither skips its code nor carries it onto other pages, and a refresh that changes or drops its code loads the page again. `<PageCode>` from `@nextlyhq/plugin-page-builder/site` draws it for a route of a site's own.

New, `@experimental`: `around` on the blocks page and content page configs of `@nextlyhq/blocks-react/next`, for what a route draws around each page it serves; a `code` op in `@nextlyhq/blocks-engine` (one undoable edit of `settings.code`, held as the `seo` op is), and `PluginFieldWrite.caller` in Nextly and the plugin SDK, which tells a plugin field type's validator who the write is made as (a user, an API key, a person, a visitor or trusted code) and whether they may perform an action, by the same decision a plugin route's `ctx.caller.can` makes, on an entry's own fields and inside its field-group instances alike, with `PluginFieldWrite.inFieldGroup` saying a value sits in one.
