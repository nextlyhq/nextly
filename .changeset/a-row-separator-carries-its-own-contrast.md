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
"@nextlyhq/plugin-form-builder": patch
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

A dashboard chart's table draws its row separators at full strength.

At half alpha they measured 1.11:1 against the page surface, where WCAG asks
3:1. A separator in a data table is structural rather than decorative — it is
what tells a reader which number belongs to which row — so it carries the
contrast a reader needs, and it now matches the shared table primitive every
other table already uses.

The plugin-route documentation's scope-narrowing example is a complete route
rather than a fragment. It referenced `ctx`, `id` and `data` with nothing
declaring them, so a reader copying it got three errors and could not see where
those values come from. It now shows the handler they arrive in.
