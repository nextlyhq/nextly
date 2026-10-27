---
"nextly": patch
"@nextlyhq/plugin-accounts": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
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

The Count card, and the content settings that let one widget read the collection each card is set to.

- **Count** (`core/count`) states how many entries a collection holds. From medium width it adds the published and draft split, and what scheduled releases will publish; at large width, the last 30 days against the 30 before. Each part links to the list that holds exactly it.
- **Offered per collection:** a widget may declare `offered: "per-collection"`. It is then never placed on the default dashboard, and any number of its cards may be placed, each starting with its collection.
- **Its query may name no source** when a Collection setting supplies one. A custom card may declare several keyed reads (`cells`), each answered on its own, and handed to its component as `cells`.
- **Content settings reach the card's query:** Filter (joined with any condition the widget declares), Sort, Group by and a Date range (`since`), each on a collection source. A stored Filter, Sort or Group by naming a field the reader may no longer use is asked with its default instead.
- **Widget queries** take `since` and `until` (spans from a closed list, measured in whole UTC days or months from the batch's one instant). On a collection source, they take the entry list's workflow conditions `_pendingChange` and `_inRelease` at the top level. A release condition is answered "not available" for a reader with no release to read.

All of it is `@experimental` while the content widgets are built.
