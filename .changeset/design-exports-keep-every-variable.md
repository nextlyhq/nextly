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

Exporting a site's variables now writes every one of them. A fluid size is written as its largest px value, with its `clamp()` kept beside it, and a variable the design-token format has no type for (a custom value, a shadow, an `em` or percentage size) is carried in Nextly's own extension. Importing the file back restores every variable exactly, fluid sizes as fluid sizes, and the file stays valid for other design tools. Importing a token file together with its theme file keeps the exact dark values the token file records.

The Figma export writes custom values as string variables and fluid sizes as their largest px value, and its report says that Figma keeps shadows as effect styles, not variables. Importing Figma files reads a string variable back as a custom value. The message after an export names each file in words, for example "variables" and "theme file: dark values". `isKind` from `@nextlyhq/blocks-engine` now accepts every token kind, `custom` included; a caller that relied on it refusing `custom` should compare the kind itself.
