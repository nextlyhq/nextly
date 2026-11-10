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

Shared styles now keep what the page shows in a few cases where they drifted:

- Detaching a shared style keeps the block's look in every state and at every
  width, including where another style the block wears sets a hover, focus or
  pressed value, or a narrower value, over the detached one.
- "Set on this block · overrides Card" now also appears when the block's value
  is set at a narrower breakpoint or in an interaction state over the style's
  wider or base value, and stays away when Reset would show the block's own
  value instead.
- Save as keeps the block's look until the new style is drawn on the canvas.
- A shared style's controls are laid out by the display it stores, not the
  block's.
- A font weight variable such as bold can be chosen for a folded weight field.
- Undo and redo of an edit to a code-supplied style store only what differs
  from the code, and a rename takes its place in the history when asked for.
- A correction back to the stored site style clears the form's saving state.
- Usage counts can be asked for again once the pages can be counted.
