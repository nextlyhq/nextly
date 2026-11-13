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

The Page Builder now has its own item in the admin rail, right after Forms, in place of its heading in the Plugins panel. Its panel lists Patterns, Components, Layouts and Templates with how many of each you can see, then Bindings to fix with a badge while any need fixing. Clicking the item opens the new Page Builder overview: the bindings to fix first, when there are any, then the four libraries with their counts and a New action for those who may create, and the collections and Singles that have a Page Builder field, each opening its list or edit page. The overview is for people who can edit pages; anyone else opening the item lands on the first library they can read. A site preferring the old place can set `placement: "plugins"` for the plugin in `admin.pluginOverrides`.
