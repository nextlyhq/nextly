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

**Behaviour change.** The preset roles (Admin, Editor, Author, Viewer) reach a collection only once it is opened to them by name: `grants: { presets: ["admin", "editor", "author", "viewer"] }` on the collection, or `presetGrants: { <slug>: [...] }` in the config for a plugin's or a Schema Builder collection. A collection added without either, from code, the Schema Builder or a plugin, is reached only by super-admins and the roles granted it by name. Existing sites keep their grants: the first `nextly migrate` or development start of this release records which presets held each existing collection before it sets any grant, and keeps them, warning which collections are kept only that way so the config can say so. Viewer no longer reads users or API keys. A declared permission can name the presets that may hold it with `presets` (`[]` for none). New options are `@experimental`.
