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

Page builder: the inspector's Content tab draws its controls from one registry keyed by
prop type, and gains a control for each type the core blocks use. A `media` prop opens the
admin's media library and stores the chosen file's id; a `richText` prop is edited with the
admin's rich-text editor; an `array` prop lists its items with Add, Remove and Move up and
down. A new `relation` prop type (`{ type: "relation", relationTo: "<collection>" }`)
searches one collection's entries by title and stores the chosen entry's id. Its search
reads through a page builder route, with the signed-in author's own access, and only for a
collection a registered block's `relation` prop names. `@nextlyhq/plugin-sdk/admin` now
exports the admin's `MediaPickerDialog` (experimental). A block prop may name itself
(`label`) and its options (`optionLabels`); the core blocks now use plain wording, and an
on/off prop is drawn as a switch. The shared rich-text editor no longer loses an edit to a
passage stored without some of its fields.
