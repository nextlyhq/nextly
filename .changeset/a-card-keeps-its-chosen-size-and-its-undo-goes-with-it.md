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

A dashboard card's quick changes hold up in three cases they did not.

- **A size a reader chose stays theirs when the default catches up.** A reader following the default who resized a card kept that size only while it differed from the default's, so once a later release gave the widget's default that same size, the next unrelated change outside customise mode (a setting, or removing another card) forgot the size was theirs, and a later change to the default moved their card. A chosen size now stays chosen while a write leaves it as stored; resizing the card, back to the default's size or to any other, is what gives it up or replaces it.
- **A quick change is always said, with its Undo.** When the card's new answer arrived before the save reported landing, the toast that says the change, and offers Undo, never appeared. It now does, as soon as the save lands. A change whose new answer was refused is still said as saved but not shown.
- **Removing a card takes its Undo toast down.** Removing a card within the ten seconds its last quick change's toast stays left that toast, and its Undo, on screen; pressing Undo could write the removed card's earlier setting or size back. The toast now goes with the card, and an Undo pressed after it does nothing.
