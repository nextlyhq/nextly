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
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

fix(admin): name the settings secret field and verify label landing

`SettingsRow` emits a `<label for>` for every row, while whether anything claims
that id depends entirely on what the caller passes as children. The email
provider's secret field wrapped its control in a positioning `<div>` inside
`FormControl`, which is a Radix `Slot` and clones onto its single child — so the
id, `aria-describedby` and `aria-invalid` all landed on the div. A label cannot
name a div, so the API key and SMTP password fields had no accessible name and
their validation errors were never announced, while the id still resolved.

`FormControl` now sits on the input itself, and a development-time check reports
both ways a label can fail to reach a control: an id nothing carries, and an id
carried by an element a label cannot name. The mechanism is shared with the
entry-form fields, which previously carried a presence-only copy that could not
see the second case.
