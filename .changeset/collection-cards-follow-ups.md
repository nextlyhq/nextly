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

Dashboard cards set to a collection are judged more precisely:

- Which collections a reader may read is now asked of every collection a card may be set to, not read off core's generated cards. Two collections whose names differ only by `_` and `-` (for example `a_b` and `a-b`) lose their generated cards to the clash, but a Count, Recent entries, Over time or Breakdown card set to either is now shown to a reader who may read it, instead of being withheld.
- A widget's Collection setting withholds a card only where the setting actually decides what the card reads. A widget whose registration replaced its query, so the setting no longer reaches it, no longer has its cards withheld for a collection it never reads.
- A saved count card converted for a reader who may not see the Count widget takes the widths Count is registered with, not the core default.
- The admin's cached workspace data is refreshed when a widget's Collection setting changes, or when the collections a reader may read change, so the settings sheet never shows an outdated setting.
