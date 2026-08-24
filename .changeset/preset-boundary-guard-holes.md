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
"create-nextly-app": patch
"nextly": patch
---

Close two holes in the preset/stylesheet boundary check, and fix the v3 config example.

The duplication guard read only the first `@layer components` block and only
plugins written as a bare function. A cascade layer may be opened more than
once, and Tailwind's own `plugin()` helper returns `{ handler, config }` rather
than the function, so a rule restated through either route passed the guard
while it reported a clean boundary.

The Tailwind v3 config in the README was not valid JavaScript and omitted the
scan path for the published bundle, so following it produced a syntax error and,
once corrected, components with their utilities missing.

Also records why three rows in the admin no longer pad themselves: the enclosing
section supplies the rhythm, and the two paddings are additive.
