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

**A blocks field inside a repeater's row now opens in the Page Builder.** The builder's address names the row by its saved id, not its position, as in `?field=sections.<rowId>.body`, so it opens the same row after the rows are reordered, at any depth of groups and repeaters. Saving writes into the row with that id and leaves the other rows as they are.

- **Rows gone or named by position:** an address whose row has been removed, or that names a row by its position (`sections.1.body`), is refused with a way back. It never opens another row, and it is never corrected to the document's only field.
- **Save once first:** a row gets its id when it is saved. A row added since the last save keeps the same Open Page Builder button, greyed out, with "Save the entry once to design this row."
- **Rows that set their own `id` field:** such a repeater gives its rows no saved id, so its rows don't open in the builder. The card says why, and the startup warning now names only these fields (and fields in any other container the builder doesn't open). A blocks field in an ordinary repeater is no longer warned about.
- **Which row:** the builder's top bar and the start of its bottom bar name where the field sits, such as "Sections · Hero banner · Body", using the row's title as the entry form shows it. Leaving returns to the entry with that row's button focused.
- **Entry fields panel:** the panel beside the builder leaves out the repeater holding the row, so its rows can't be reordered or removed under the open editor.
- **A save after the row moved or went:** each write from the builder first finds the row by its id. If the row is gone, the save is refused with a message and nothing is written into another row.
- **For plugin authors:** `DocumentViewProps` gains `fieldAddress`, `fieldLocation` and `fieldPathIn`, and `useFieldAddress` gives a field its address (all experimental). Nothing changes for an existing view of a field outside repeaters.
