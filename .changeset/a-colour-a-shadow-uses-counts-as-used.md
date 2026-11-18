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

A colour used only through a shadow now counts as used, so it can't be removed while the shadow still uses it. A shadow stores its colour as `var(--site-…)` in its CSS, and the usage count now reads that the same way it reads a colour chosen from the picker. This covers a block's shadow, a shared style's shadow and a shadow variable's value. The same is true for any CSS value that names a site variable through `var()`.

When you remove a colour that a shadow variable uses, the refusal names that variable, for example "Accent is used by the variable Lift." You can remove the two together. A `var()` that names no variable of the site is never refused, and it doesn't count as a use.

After you upgrade, the site's pages are counted again, so the colours that older pages use through a shadow are counted too. Until that recount finishes, the Variables panel says the counts are incomplete.
