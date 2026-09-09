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
---

A spacing drag handle sat on the wrong edge for half the sides, and dragged
backwards there.

Which edge of a band moves when its value grows is a property of the layout, not
of the box: a `margin-top` in normal flow moves the block's border edge down
while its outer edge stays pinned by whatever precedes it, and `margin-bottom`
does the opposite. The editor now asks the element instead of assuming, for
margins as it already did for paddings, so the control sits on the edge that
responds and the drag follows the pointer on every side.

The probe's answers are also cleared before the measurement that reads them,
rather than after it — so a block that changes from content-sized to fixed-sized
picks up its new answer immediately instead of waiting for an unrelated resize.
