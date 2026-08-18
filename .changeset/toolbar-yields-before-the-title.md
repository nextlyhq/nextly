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

The document header's title input no longer collapses.

The title was a `flex-1` beside an action cluster that never shrank, so it got
whatever was left: measured on `main`, `row - 598px`, which is 34px in a
1280-wide window and 0 at 900. It reproduced on non-localized collections too,
so this was general header behaviour rather than anything about translations.

Actions now yield before the title does. As the toolbar narrows, supporting
labels (preview, copy link) drop to their icons, then publish and unpublish do;
the primary Save never collapses, and the title keeps a readable floor. A
collapsed label becomes `sr-only` rather than being removed, so every control
keeps the accessible name it had at full width.

The queries read the toolbar's own width rather than the viewport's, because the
document rail is 320px wide and hides at its own breakpoint — one window width
produces two different toolbar widths, and only the toolbar knows how much room
the toolbar has.
