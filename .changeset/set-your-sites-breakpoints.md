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

You can now set your site's breakpoints from the editor.

A Breakpoints button in the top bar opens the manager, showing how many the site defines. Add the
widths your styles should respond to, on the browser window or on a block's own container, and save
— the canvas compiles against them immediately and every page follows.

An id is fixed once saved, because it is the key your stored styles are filed under; renaming one
would quietly detach every style on every page that uses it. Removing a breakpoint is not
destructive either: styles filed under it simply stop applying, and come back if you add it again
with the same id.

The button stays unavailable until your saved styles have finished loading, so the dialog can never
open on the defaults and save them over the breakpoints you already had.
