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

A field rewrite of a collection entry (`rewriteField`, `@experimental`) now matches a Single's in two places:

- **Field rules judge the value being replaced.** A rewrite made for a person applies the field write rules to each copy's new value against the value it replaces, as an update does. A replacement group or repeater that leaves out, or changes, a value the person may not change is refused with `FORBIDDEN`, and nothing is written. Before, the rules saw only the new value, so leaving a protected child out of a group deleted it. The refusal names each protected field (`publicData.errors[].path`, such as `card.locked`) and the copy, for an entry and a Single alike.
- **A translated rewrite moves only its language's version.** Where a rewrite of a translated field changes only one language's live value, only that language's version moves. A read of another language stays current, so its rewrite or save isn't refused as out of date. The entry's own version still moves when a shared field or any draft changes.
