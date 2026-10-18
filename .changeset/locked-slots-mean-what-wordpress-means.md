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

Locked slots mean what WordPress's `templateLock` means, and every writer is
held to them: the editor, the API, an import or an agent. A slot's lock is
measured against the blocks the slot starts with (its `defaultBlock`):

- `insert`: blocks cannot be added or removed, but can be reordered;
- `all`: blocks cannot be added, removed or moved, but their content and
  design stay editable;
- `contentOnly`: only content can change. A block declares its content props
  with `role: "content"` (WordPress's spelling); its other props, its styles,
  classes, CSS id, HTML attributes, visibility, custom CSS and lock stay as the
  block started;
- `false`: no lock.

A slot that declares no lock inherits its parent's, `false` stops that, and
nothing beneath `contentOnly` can loosen it. A save that breaks a lock is
refused with the slot and the rule named, and so is a page whose component
placement reaches past a lock inside the component, through an exposed value
or through content it supplies to an exposed slot.

Registration refuses a lock value outside the four, and a prop `role` other
than `"content"`, naming the block. A block that declares no content props has
nothing editable inside a `contentOnly` slot: declare `role: "content"` on the
props an author should be able to change there. The core blocks declare theirs:
a heading's text and link, a paragraph's and a rich text's text, an image's
picture, alt text and caption, a button's label and link, a quote, a list's
items, an embed's address and title, an accordion item's title and a form's
submit label.

Inside a `contentOnly` slot a save may keep any value the page already stores in
the same place, or put it back as the block now starts; only a third value is
refused. So changing a block's `defaultProps` doesn't lock existing pages out,
and a page placing a component keeps what the component itself holds. A page
saved for the first time, a single, and a localized blocks field are measured
against the starting blocks alone. Whether a block renders is held too: a version ahead of its
definition's, or `migrationFailed`, can't be newly set there.

`nextly generate` refuses a slot `lock` outside the four and a prop `role`
other than `"content"`, as registration does, so a block manifest is never
written for blocks the app would refuse at boot.
