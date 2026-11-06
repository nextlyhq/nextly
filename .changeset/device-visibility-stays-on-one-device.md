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

`@nextlyhq/blocks-engine` exports per-device visibility helpers:
`deviceVisibility` reads which devices a block shows on, resolved exactly as
the published stylesheet resolves them; `setDeviceVisibility` hides or shows a
block on one device while every other device keeps what it showed; and
`carryDeviceVisibility` / `carryDocumentDeviceVisibility` carry stored hide
settings across a change of the site's breakpoints, so a removed breakpoint
leaves nothing behind (a breakpoint added later under the same name starts
visible) and an added one shows what its width showed before.
`revealDeviceHidden` lifts a block's device hiding in a document drawn by an
editor, for showing a hidden block while it is selected. The style compiler now
reads the same cascade, with no change to the CSS it writes.
