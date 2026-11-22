---
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"nextly": patch
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

An entry's required field left empty now says "{Label} is required." for every field type, the server's own wording, instead of a type error such as "Invalid option: expected one of …" for a select, number or date — an empty list on a required multi-value select, relationship or upload included, which the form used to pass on for the server to refuse; chips and a repeater stay with their row-count rules. A pattern with no custom message names the field ("Password does not match the required format."), and the builder asks for a message once a pattern is written. Clearable is on by default: an optional select offers its clear button unless `admin.isClearable: false` turns it off — a change for fields defined in code without the flag, whose documented default is now `true` — and never on a required field; an optional radio group can be cleared the same way. A field's Name is marked required in its settings, and a blank Label is explained as showing the name.
