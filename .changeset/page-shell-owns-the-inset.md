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

Add `PageShell` and `Bleed`, the admin's page-level layout primitives.

`PageShell` owns a page's horizontal inset and its measure, and spends both as
grid columns rather than as padding. That difference fixes a class of layout bug
rather than one instance of it: padding cannot be cancelled by a descendant, so a
block that needed to run edge-to-edge previously had to be rendered outside the
wrapper imposing the measure, and two wrappers that each applied an inset
silently added theirs together. As columns there is a single declaration, every
child shares a left edge by default, and `Bleed` turns full-bleed content into
something a page declares rather than something it achieves by accident.

Both are `@experimental`. Nothing renders them yet — pages migrate onto them
separately — so this release changes no existing page.
