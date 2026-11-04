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

Layers is now a working tree. Pointing at a row outlines its block on the
canvas, and choosing one selects it and scrolls the canvas to it. A row's eye
hides its block on the device being edited only, on the canvas and the
published page; a hidden block chosen in Layers is drawn while it is selected,
its ring tagged "Hidden on" the device. A row's padlock locks its block, and a
row renames in place by double-click, F2 or its menu. Right-clicking a row
opens its menu: Rename, hide or show on the device, Lock or Unlock, and the
block's other actions. Ctrl/⌘+Shift+H and Ctrl/⌘+Shift+L hide and lock the
focused row's block. The Content tab gains "Visible on", which shows each
device's state and hides or shows the block on any one of them.
