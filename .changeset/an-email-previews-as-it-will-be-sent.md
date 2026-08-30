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

An email template preview now shows exactly what will be sent.

Previewing a template and sending it were composed separately, and had drifted:
the preview left out the hidden preheader line, rendered a layout's own
`{{year}}` and `{{appName}}` as blanks — so a layout footer previewed empty —
escaped a subject that is delivered as plain text, and never showed the
plain-text part of the message at all. Both now go through one composition, so
they cannot disagree.

Previews also work before a template is saved. A new
`POST /api/email-templates/preview` renders template fields directly, which the
existing per-template preview route cannot do: it reads the stored row, so it
shows nothing of what is being typed and has no row to read at all while a
template is being created.
