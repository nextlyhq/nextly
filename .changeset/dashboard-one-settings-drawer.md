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

A dashboard card's settings now live in one place: its menu's Settings… opens one drawer with a preview of the card, then Content, Display and Size, all open, with nothing folded under "Advanced". Changes apply when you press Save (Cancel, Escape or the close button discard them); outside Customize, Save keeps them for you at once, and in Customize it keeps them with the rest of your changes until you save the dashboard.

- Clicking a card's title no longer opens a quick-settings popover, and the card menus no longer offer Width or Height. The width is chosen in the drawer's Size section, in percent (a width saved before that is not one of the choices stays selected until you pick another). Cards are as tall as their content, so there is no height setting.
- The card menu holds Settings…, Refresh and Remove; in Customize it adds Move earlier and Move later (Move to start and Move to end are gone).
- A list's "Number of entries" is a choice of 5, 10 or 20, still stored as a number: a number saved before (say 7) is shown and kept until you choose another.
- List density is now "Row spacing" (Comfortable or Compact) under Display.
- The Note's text says it supports Markdown, with examples, and counts the characters left of its 2,000.

Compatibility: `defineWidget` declarations are unchanged. A setting's `section: "advanced"` is still accepted and is drawn under Display; `quick` still marks the setting a card's header draws. Stored layouts and settings are not rewritten.
