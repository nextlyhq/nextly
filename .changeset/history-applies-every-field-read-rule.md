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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
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
---

History applies every field read rule. A version read, a comparison and a
restore now judge the field-level `access.read` rules declared on a
component's own fields, on each instance the version holds and at any depth,
alongside the entity's own rules. An API key is judged on its own grants
rather than its owner's.

A version read lists what it held back in a new `withheld` field (a field
name, or a dotted path such as `banner.secret`), and a comparison shows such
a field as `hidden` in its place, inside components too. History fails
closed: if the rules cannot be evaluated, a version read withholds every
field that carries one and names it, and a restore is refused (`FORBIDDEN`)
instead of being applied unfiltered.
