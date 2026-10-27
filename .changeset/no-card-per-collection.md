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

The dashboard no longer makes a card per collection and per Single. A card about one collection is a core widget (Count, Breakdown, Over time or Recent entries) whose Collection setting names it, so adding a collection adds no widget. **Breaking:**

- The `collection/<slug>-<kind>` and `single/<slug>-<kind>` cards are no longer offered, drawn or accepted.
- A saved dashboard holding one drops it when it is read, and the next save stores the dashboard without it.
- A layout write naming one is refused, with a message saying to add a core widget set to that collection instead.
- A site config (`dashboard.defaultLayout`, `hide` or `overrides`) naming one is refused at startup, naming the id and the core widgets that replace it.
