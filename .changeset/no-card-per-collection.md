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

The dashboard no longer makes a card per collection or per Single. A card about one collection is a core widget (Count, Breakdown, Over time or Recent entries) whose Collection setting names it, so adding a collection adds no widget. A Single's edits show in Recently edited (`core/recently-edited`). **Breaking:**

- The `collection/<slug>-<kind>` and `single/<slug>-<kind>` cards are no longer offered, drawn or accepted.
- A saved dashboard holding one drops it when it is read, and the next save stores the dashboard without it.
- A layout write naming one is refused, and so is `registerWidget` with an id in either namespace, at startup. The message says the card is retired and what replaced it: add Count, Breakdown, Over time or Recent entries and set its Collection to the collection's slug, or, for a Single, that its edits show in Recently edited.
- A site config (`dashboard.defaultLayout`, `hide` or `overrides`) naming one is refused at startup, an optional `defaultLayout` card included, naming the id and what replaced it.
