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

Drag either edge of the page on the builder's canvas to preview it at any width, from 320px to the Desktop width. Both edges move together, so the page stays centred. While you drag, a ruler above the page marks where each breakpoint starts, such as "768 Tablet" and "1024 Desktop", and the edge snaps to a mark when it passes close to it.

Previewing a width doesn't change the device you are styling, and every edit still goes to that device. While a custom width is shown, the width beside the device buttons turns amber and a "Reset" button appears beside it. A line under the page reads "Previewing at 900px · still editing Desktop styles". Reset, choosing a device, switching to another page or reloading all go back to the device's own width. The custom width is never saved.

Each edge is a "Preview width" slider for the keyboard:

- the arrow keys move it 10px, or 1px with Shift;
- Page Up and Page Down move it to the next ruler mark;
- Home and End go to the narrowest and widest width.

Screen readers hear the new width once it settles. You can also click the width beside the device buttons and type one: Enter applies it and Escape cancels.
