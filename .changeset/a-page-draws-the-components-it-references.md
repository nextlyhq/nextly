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

A page could reference a reusable component and nothing drew it. The engine
knew how to replace the reference with the component's own blocks, but no
reader ran that step — so the renderer, the stylesheet, the page reader and the
route helper all worked from a document with a hole in it.

Composition is now a pass of the pipeline every one of those readers already
shares, so a component resolved for one of them is resolved for all four. It
runs before migration, so a component authored against an older version of a
block is brought up to date like any other content rather than handed over as
stored, and the components themselves are repaired against the same limits the
page is — an unchecked block inside a component would otherwise reach the page
through a door the page's own checks had closed.

A page also reports which components it drew and which it could not, so
whatever fetched them can keep the page up to date when they change.

A component that could not be loaded now says so where it sits, instead of
reading as an unrecognised block. A stored stylesheet is no longer reused once
composition has added blocks it was never compiled for, which would have left
every one of them unstyled on a page that looked fine.
