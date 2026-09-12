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
"@nextlyhq/plugin-form-builder": patch
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
"@nextlyhq/plugin-mcp": patch
---

A `defaultValue` written as a function now works on a reusable field group's children. A field group's fields are read from its stored definition on every write, and a function does not survive being stored, so only constants applied there: a function default on a field-group child was silently dropped on every write. Field groups now get the same live-config capture collections and Singles have, so the function form resolves from the config at boot, and it is re-read when the dev server reloads the config. It resolves against the instance being built, so a child may compute from a sibling defaulted before it.

Only the default is wired. The same capture holds a field's `access` rules, hooks and `validate`, and nothing reads those for a field group, so registering them changes nothing about whether they are enforced.
