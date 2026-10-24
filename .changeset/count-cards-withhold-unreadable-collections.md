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

A dashboard card set to a collection the reader may not read is no longer handed to them. Their layout read leaves it out, exactly as it leaves out a card of a widget they may not see, and their saves keep it in place, so it returns once they may read the collection. A collection that does not exist is treated the same way, so a reader cannot learn which collections exist from what comes back. A save that adds such a card is refused, with one answer whether the collection exists or not. The card's collection is read as its settings resolve it, its declared default included.

Saved count and health cards converting to Count cards also change in four ways:

- A card whose id two collections in the install could spell is set to no collection, even when the reader may read only one of them.
- The merged card's width comes from the Count widget as registered, including a plugin's changes to it.
- A layout saved from a snapshot taken before a collection was renamed between such spellings (`a_b` to `a-b`) is refused, so it cannot write the old name back.
- The collections the conversion reads come from the same refresh as the reader's cards.
