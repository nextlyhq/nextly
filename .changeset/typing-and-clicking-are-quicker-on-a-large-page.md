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
---

Typing in a settings field, and clicking a block, are quicker on a large page.
The editor did the same work again on every keystroke and every click:

- The repair notice planned the whole page's repair on every edit, and again on
  every selection. A page with nothing to repair, which is most pages, now gets
  its answer without copying or measuring the page, and the notice plans once
  per document rather than once per click. `RepairRule` takes an optional
  `finds(document, context)`: when every rule answers `false`, `planRepair`
  returns the document itself as the result. The engine's lock and placement
  rules both answer it.
- The canvas's Form notices looked up each drawn block with its own walk of the
  page, and now walk it once per measure.
- The block panel checked each field's locks separately, composing the page and
  walking its locks once per field. It now reads them once per render for the
  whole block (`writablePropsOf`), and each field's answer is the same as before.
- Every page check ran again on every click and keystroke, because the page
  being edited and the page's data count were new objects on each render, and
  so were the bindings rows. They now stay the same while what they hold does,
  and the Page checks count is worked out a moment after an edit rather than
  inside it.
- A check run on every render that the canvas marks are still over the same
  canvas laid the editor out each time. The frame's painted scale is now
  measured only when something reads it.
- The Style tab's cascade compiled the page's styles a second time inside each
  keystroke. It is now compiled from the edit straight after it.

Nothing saved, validated or published changes, and no edit skips a check.
