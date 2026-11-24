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

An email template's test data is now edited as a field per declared variable,
drawn from the variable's type (text, number, money, date, link, a switch, a
list's rows, an object's fields), or as the JSON it is. Both edit the same
data, and a JSON that does not parse keeps the fields from showing it until it
is fixed or reset.

The test data can also be filled from a real record. A template's owner may
offer `sampleRecords` beside it (`@experimental`): what the records are, what
they are read from (`"users"` or `{ collection }`), and a `list` and a `load`.
Nextly asks whether the person may read that before the loader runs, so a
person refused never reaches it, and what a record answers fills the preview
and is stored nowhere. `GET /api/email-templates/{id}/sample-records` lists the
records and `GET /api/email-templates/{id}/sample-records/{recordId}` loads
one's values. Core's welcome, password-reset and email-verification emails
offer a real user to a person who may read users.
