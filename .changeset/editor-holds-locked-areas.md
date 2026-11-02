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

The page builder now holds a locked area while it is edited, not only when the
page is saved. A drop, an insert, a keyboard move, a delete or a duplicate that
a slot's lock refuses is refused before it happens, with the reason in words:
the drop indicator, the inserter, the toolbar and the context menu say why, and
the keyboard announces it. The editor asks the same question a save asks,
against the page as last saved, so the two cannot disagree. That includes
content a placement gives a component's own locked slot.

Inside an area locked to its content, a block's content stays editable and its
other settings show read-only with the reason: its non-content fields, the
Style and Advanced tabs, and its own lock. Its spacing handles are off.

A page that already holds what a lock doesn't allow, stored before locks were
enforced, shows a notice offering a repair. Each step is shown first, and
nothing changes until you confirm. The repair is then one edit you can undo. No
block you placed is removed: one a locked area may not hold moves to just after
that area.
