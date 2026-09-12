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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
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
---

Field defaults now reach every write that applies them, at every depth. A `defaultValue` declared as a function is applied on an ordinary REST or Direct API collection create; before, a collection's fields reached that write from their stored definition, where a function does not survive, so the field was left empty. A new field-group instance fills the defaults its own fields declare before it is validated, so a required child with a default no longer refuses an instance the caller could not have completed. A Single's first read fills the defaults declared inside its groups and repeater rows, and refuses a password default at any depth, as it already did at the top level. In a LOCALIZED field group, a repeatable or dynamic-zone instance is now prepared before its write is split between the main row and the companion row, so the defaults it takes, the relationships it normalizes and the passwords it hashes reach the rows that are stored rather than being left on a payload the split had already copied.
