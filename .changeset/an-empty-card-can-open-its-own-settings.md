---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
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
---

A widget's empty state can now offer the card's own settings as its action: `empty: { action: { label: "Choose a collection", opens: "settings" } }` beside the existing `{ label, link, permission? }`. The card draws it as a button that opens that card's settings sheet with focus on its first field. The button appears only at rest, and only where the reader can change that card's settings, so a settings preview, customise mode, or a card whose settings can't be saved right now shows the message alone. Startup refuses an action that gives both `opens` and a link or permission, any `opens` value other than `"settings"`, and `opens: "settings"` on a widget that declares no settings. Core's Note uses it: an unwritten Note now reads "Nothing written yet." with a "Write a note" button.
