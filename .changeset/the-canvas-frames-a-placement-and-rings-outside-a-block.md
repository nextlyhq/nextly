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

The page builder's canvas marks read more clearly. A selected component placement gets one purple frame around all of its parts, tagged "◇" with the placement's name as Layers shows it. Its exposed parts keep their dashed outline while it is selected, including a part that is also one of the placement's own top-level elements. The selection ring sits outside the block, so it no longer covers the first letter of a heading set flush with its box, at the page's edge too: the canvas's chrome draws a few pixels past the frame for it. A heading, paragraph or other text block emptied of its words keeps one line of height while empty elements are shown, so it can still be clicked. On a page the site serves, the canvas keeps the language and direction the site's own page states when the editor names none, and a header or footer the site's layout takes out gets back the state it had. `@nextlyhq/builder` adds `blockNameOf`, and `CanvasMarks` takes an optional `nameOf`.
