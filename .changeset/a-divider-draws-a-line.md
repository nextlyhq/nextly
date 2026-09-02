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

A divider draws a line, and a spacer takes up space.

Both blocks rendered nothing an author could see. `core/divider` is an `<hr>`,
which a user agent draws with an inset 3D border no design system wants and a
CSS reset removes entirely — so the element was either wrong or invisible
depending on the host. It now states all four sides itself: three at zero and
one hairline in the border token, a token because it is a colour and a literal
would be wrong in whichever of light and dark it was not chosen for.

`core/spacer` renders an empty `<div>`, which is zero-high with nothing
declared, so inserting one produced no space and nothing to select. It starts at
`2rem`. That stays a style rather than becoming a prop — height is per-breakpoint
in this system — so any breakpoint may override it.

The population assertion in `base-styles.test.tsx` names both, which is what
makes a future block that declares a default the compiler silently drops fail
here rather than in a browser.
