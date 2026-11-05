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

The inspector now offers a collection loop the site's collections as a menu, searchable once there are more than ten, and sorts it by a menu of the chosen collection's fields (dates first) with a direction toggle, instead of asking for a slug and a sort key by hand. An image's loading is now one switch, "Load immediately"; its source is one "Library | URL" choice showing only the chosen side; and its alt text is one "From library | Custom | Decorative" choice, with the library's words shown and a Custom field that grows with its words. Each choice that changes two props is one step to undo. A newly placed image no longer stores an alt of its own (it was placed with `alt: ""`, read as decorative), so a library file picked for it is described by the library's alt text with no extra step; images already on a page are unchanged. A library file picked for an image that still holds its placeholder address replaces that address; an address an author typed is still kept as the file's fallback. Stored values do not change: a loop still stores the slug and the `field` or `-field` sort string, further sort keys are kept as stored, and a stored collection, field or image state that fits no option is still shown as it is.
