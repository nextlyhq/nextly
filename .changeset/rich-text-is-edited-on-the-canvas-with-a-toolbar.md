---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

A Rich text is edited on the canvas with the floating bar: select words for "B", "I", "Link", "H2", "H3", bullets, numbers, quote and "Turn into", in the same editor as every rich-text field in Nextly. Pressing a heading, list or quote again turns the line back into a paragraph, and the button for the line the caret is in shows as pressed. In the inspector, a Rich text says "Edit on the canvas. Select text for bold, links, headings and lists." and offers "Open the full editor": a large editor with the same buttons, Done to keep the changes and Cancel to discard them, which returns to the block either way. Its Text field is at least four lines tall, grows with its words, and no longer changes size when it is focused.

The admin's shared inline editor gains a `block` verb (H2, H3, bullets, numbers, quote, or back to a paragraph) and reports the block under the caret in its selection state, with an `onSelection` option for a whole passage. Its bold, italic, link and block verbs now apply at once rather than on the next update. All additive; nothing stored changes shape, and live pages render as before.
