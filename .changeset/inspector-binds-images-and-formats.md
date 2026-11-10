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

The inspector binds an image, and a date's or a number's format: a prop inside a group (an image's source, its address and alt text, a link's address) now offers the bind button its own row would, through the group's `bindable(propName, field)` wrapper; a bound image's Fallback is an image address shown with a small picture of it (`ImageBindingFallback`, exported from `@nextlyhq/builder/shell`); unbinding an image visitors saw by its address keeps the address in the block's address prop and says so under the Source row; a text prop bound to a date or a number gets a Format row whose presets are those the engine's `checkFormat` accepts for the field, with a stored format it refuses shown as refused; and a bound prop's menu offers Open source, the admin screen its field is edited on, from the new `ContentServices.sourceHref`.
