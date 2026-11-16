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

Field rules in field groups now hold at more of a write's edges.

- **A new instance's inline field groups:** an update that adds a field-group instance creates the field groups it holds inline with it, so a child its create rule allows is stored rather than dropped. A single field group's instance sent without its id is still judged as the update its save makes.
- **Repeated row ids:** a repeater or field-group list row repeating another's id takes none of the stored row's protected values, and every row is judged by its own siblings.
- **Translated groups:** in a localized collection, a field group held in a translated group keeps a child its update rule denies, in each language.
- **Fields named like store columns:** a field a field group declares, named like one of the store's own columns (such as `updatedAt` inside a group), is judged as content when a publish is checked, so a pending edit to it that the publisher may not write is refused rather than lost.
- **Held drafts in every language:** a held draft that removes an instance keeps it when it holds a protected value in any language, without relying on the update's own check.
- **Protected passwords:** an update that clears a field-group instance, or leaves it out of a list, keeps it when a rule protects its password, though the stored hash is never read back.
