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

A template variable may now declare what kind of value it holds (`type`: text,
number, date, money, link, boolean, list or object), a friendly `label`, an
`example`, and for a list or an object its `fields`. Today's declarations
read and save as they are, and the admin API now refuses a malformed one.

These shape only the editor's test data: a send renders whatever it is given.
An owner's later presentation reaches every copy of its template, overridden
or not, and never makes a template the site's or asks it to review an update.
Core's built-in templates and the accounts plugin's declare theirs.

The template editor finds the variables a template uses from the parsed
template, in every field, so filters, tags, loops and bracket access are read
and loop items are left out. It lists those not yet declared, with a Declare
action where the site owns the template. It also marks, in the editor and the
Data panel, each variable that would show blank: no test value and no
`| default:` fallback.
