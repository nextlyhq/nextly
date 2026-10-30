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

A dashboard card's common settings change on the card itself, and every card's menu offers the same four things.

- **The quick popover**: a card's title, and Settings in its "…" menu, open a popover holding the card's Collection, the settings its widget marks quick (a period, such as Over time's Date range) and its Size, ending with "More settings", which opens the settings sheet. A change applies to the card at once, with the popover still open and the card beside it. Outside customise mode it is saved for that reader alone, and a toast says so and offers Undo, which puts back what the card had just before that change; the toast is the one place a screen reader hears it, and the dashboard's own announcement stays silent for it. In customise mode it is staged with the session's other changes until Save. Escape closes it, and focus goes back to the title or the menu it was opened from.
- **Every card's menu at rest lists Settings, Size, Refresh and Remove**, in that order, each where the card has it. Size saves the card's width and height at once, with Undo, through the same layout write customise mode's Save makes. A reader following the default keeps a size they choose this way: the stored row now records which cards they resized, held to each widget's bounds, while every other card goes on following the size the default gives it. Rows written before this read as they always did, with no migration, and resetting the dashboard clears the sizes with the rest. Remove takes any card off at once, asking nothing, with Undo in the removal notice. For a reader following the default dashboard it is their own dismissal of the card, so they keep following the default; for a reader who has arranged their dashboard it takes the card out of their arrangement, so adding the widget again from the gallery meets no hidden copy, and Undo puts it back where it was, with its settings. The layout read now says which of the two a reader is (`arranged`). Before, only a card whose widget declared `dismissible` could be removed outside customise mode, with a dismiss button of its own; that button is gone, and `dismissible` is deprecated: it has no effect, is still accepted, and will be removed with the legacy definition fields. The customise menu now lists Settings and Size first, then the moves, then Remove.
- **A widget may mark up to three settings `quick`**, where it could mark one. A declaration marking two or three, which startup refused, now starts; one marking four or more is still refused, with each named. The limit is published as `MAX_QUICK_SETTINGS` from `nextly/config`, beside `MAX_CHOSEN_FIELDS`, and the quick popover holds that many beside the card's Collection. The card's header draws the first marked setting it can draw.
- **A dashboard write no longer re-asks every card.** Each read of the layout carries a read-ahead token of its own, and the cards' batch was asked again under every new one, so the layout read that follows a reader's own write (a quick setting, a size, a removal) asked every card on the dashboard again for one card's change. The batch now takes a fresh layout answer's token only when that answer hides or reveals a card, so a write asks again only the card it changed, and a fresh read that reveals a card still has the batch asked for it once.
- **Entering customise mode takes a card's Undo toast down**, so an Undo pressed after customising began no longer writes underneath the open draft.
