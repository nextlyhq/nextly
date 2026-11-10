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

Block visibility conditions now have a closed operator vocabulary and an evaluator in the blocks engine. A condition uses `equals`, `not_equals`, `contains`, `not_contains`, `greater_than`, `less_than`, `exists`, `not_exists`, `is_true` or `is_false` on one field of the entry, or of the list item for a block inside a list. The older spellings `eq`, `ne`, `neq`, `gt` and `lt` are read as the operators they name, and `canonicalConditions` rewrites them for storage. `evaluateConditions` decides whether a block is shown. It reads only the fields the public may read, and it hides and reports any condition it cannot check: an unknown operator or field, a protected field, or a value of the wrong type. Saving a page now refuses an unknown operator, and, when the schema is known, a field that is missing or protected and an operator or value that does not fit the field. A problem the stored page already held is reported as a warning, so existing pages stay savable. The renderer still leaves every conditioned block out of the page until it starts asking the evaluator.
