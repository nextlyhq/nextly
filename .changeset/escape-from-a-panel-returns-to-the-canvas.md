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

In the page builder, Escape pressed on a control in the inspector or a side panel now sends focus back to the canvas and keeps the block selected; the next Escape moves the selection up as before. Picking a colour variable and then pressing Escape no longer empties the inspector. Escape on the canvas, in a text field or in an open menu or picker behaves as it did.

**Compatibility:** `escapeOutcome` from `@nextlyhq/builder` (experimental) now takes a second argument, `{ origin, canvasFrame }`, describing where the press started, and can return `"return-to-canvas"`. A host calling it passes the keydown's target and the canvas frame, and handles the new outcome by focusing the frame.
