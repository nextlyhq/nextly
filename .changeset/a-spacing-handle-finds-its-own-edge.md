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

A spacing drag handle sat on the wrong edge for most margins, and dragged
backwards there.

Which edge of a band moves when its value grows is a property of the layout
rather than of the box. Measured in Chromium, growing `margin-top` drives the
block's border edge down while its outer edge stays pinned by whatever precedes
it; `margin-left` does the same against the container, and so does `margin-right`
on a block whose width is auto — while `margin-bottom`, and `margin-right` on a
fixed width, do the opposite. The editor now asks the element on every side, for
margins as it already did for paddings, so the handle sits on the edge that
responds and the drag follows the pointer.

The probe's answers are now reached through the document they were measured
from, so an edit that turns a content-sized block into a fixed-sized one takes
its new answer immediately rather than waiting for an unrelated resize.
