---
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

A component's variants can now be defined, renamed and deleted in the component's own view, and a placement picks one in its inspector. A variant's id is its stored key, so a rename keeps every placement on it, and a new variant gets an opaque key that is never reused. Variant names are unique per component, ignoring case and spaces: a save that creates a clash is refused, while a clash already stored is only warned about. A page write that newly sets a variant the component does not define is refused. Deleting a variant shows how many placements use it, and those placements show the component's defaults while keeping their own values; the inspector says "Variant removed, showing defaults" with Clear. A variant that presets nothing is marked "(no changes)".
