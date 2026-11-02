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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

In the Page Builder, the device you choose is the breakpoint you style, and nothing else changes it. Before, the editor read the breakpoint off the canvas's width, so opening a panel, or a narrower window, sent your edits to a narrower breakpoint (at the 1280px minimum with a panel open, Desktop styling landed on Mobile) and the published page didn't show them.

- The canvas lays the page out at the device's own width, Desktop at 1280px (or one pixel past the widest breakpoint) and each other breakpoint at its `maxWidth`, and the zoom fits it into the room the panels leave.
- The device buttons name the base breakpoint Desktop and show the chosen device's exact width, such as "Tablet · 1024px". The editor remembers the device you left.
- The zoom menu reads "Fit · 72%" while it fits. Ctrl+0 (⌘0 on a Mac) shows actual size, and Shift+1 fits again. Choosing another device goes back to fitting.
- If the breakpoint you were styling is removed, the editor goes back to Desktop.

For hosts of `@nextlyhq/builder` (experimental API):

- `BuilderShell` takes `editingBreakpointRequest` and reports the device through `onEditingBreakpointChange`, the way it reports the zoom. Its stored preferences gain `editingBreakpoint`.
- `BreakpointSwitcher` takes `selected` (a breakpoint id) and calls `onSelect` with an id; `width` and `appliedWidth` are gone.
- New from `@nextlyhq/builder/shell`: `previewWidth`, `editingBreakpointOf` and `DESKTOP_PREVIEW_WIDTH`.
