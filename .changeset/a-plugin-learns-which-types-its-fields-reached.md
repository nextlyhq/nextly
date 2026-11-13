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

A plugin that adds a field to every content type can now find out which types the field reached, and Page Builder's pages are among them. All three additions are experimental.

- `typesExtendedBy(plugin, field)`, from `@nextlyhq/plugin-sdk` and `nextly`, lists the collections and Singles where a plugin's `extend` added a field at the latest start. Schema Builder types are included. A type a scope left alone because it already had a field by that name is not listed, and neither is one the scope excepts.
- An admin contribution's `extendedWith: ["field"]` offers it only on those types. A tab that edits the field follows it to Schema Builder types, and is never drawn on a type that kept a field of its own by that name.
- A plugin's collection marked `siteContent: true` holds the site's own content, so "every content type" scopes reach it as they reach the site's own collections. Page Builder marks its `pages` collection. Its other collections, and every other plugin's, stay out of scopes as before. Nothing changes until a plugin uses a scope: a site whose plugins name their collections, as every first-party plugin does today, sees no change.
