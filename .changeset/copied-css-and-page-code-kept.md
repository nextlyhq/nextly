---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

Copying a page now keeps its custom CSS and page code for editors. Someone
without the site settings permission may duplicate a page that has page CSS,
block CSS or page code, and may save blocks with CSS as a saved section or
turn them into a component, because CSS and code copied byte for byte from an
entry they can read are no change. The same holds for an API key: a copy byte
for byte is allowed, and any changed CSS or code is still refused to a key.
Text the source doesn't hold (an override, an edit), a draft-only text the
caller couldn't read, and a source the caller can't read are all refused.

Core reads the source as the caller before it creates the copy, and only then
tells the new entry's field validators what it copies, through the new
`@experimental` `PluginFieldWrite.copiedFrom`. Server code creates such a copy
with the new `@experimental` `createFromSource` (Direct API) or
`createEntryFromSource` (the collection service, and a plugin's
`ctx.services.collections`), intended to become stable; a duplicate is the same
create. No REST request can name a copy: not its body, query or headers.
