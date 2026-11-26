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

Repeaters, groups and components keep one structure across languages, the remaining edges:

- A component placed under `localized: false`, on itself or on a container around it, is shared whole and gives its container no translations column; a group with no name marked `localized: false` shares the fields it lays out, as the editor shows them.
- An instance of a component offering several types that changes type drops the earlier type's text in every language, so changing it back does not bring that text back.
- A Single's field rewrite and a publish of every language drop a removed row's text and its records in every language, as a save does; a published language's text copied from another language keeps its record as a copy.
- A batch edit of the text inside a repeater or group leaves the document's version as it was, as a single edit does, so another language's editor still saves.
- A filter or sort on a repeater or group reads its structure, as a read returns it, not one language's text.
- In the editor, copying a document from another language reaches containers inside a group with no name and records the text it copied inside rows as copied; copying and "use the source" take an instance's text only from an instance of the same component type.
- The language panel's "Start from…" and "Replace from…" buttons are named with their visible text first, then the language they fill.
- Known limit: turning translation on for an entity with content copies each container's text to the default language and leaves it in the shared structure too, until the entry's next save; until then, a read in another language with fallback set to none shows the default language's text there. Nothing is lost.
