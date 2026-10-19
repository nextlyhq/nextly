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

Publishing now validates the document as it goes live. Before, a status-only
publish that promoted no pending draft (a first publication, a republish after
an unpublish, a collection or Single without drafts, or publishing every
language at once) validated only the patch, `{ status }`, so the stored document
went live judged only as it had been when saved as a draft. Now the stored
document, with the patch on top, is validated as published. This holds for
collection entries and Singles, through the Direct API, REST, bulk updates,
`updateMany` and `publishAllLocales`, which judges each language it puts live.
A Single's promotion of a pending draft is judged with the status it publishes.
For the page builder, a page whose components are deeper once published than
in their drafts is now refused at publish, on its field.

Compatibility: this applies to every collection and Single with a
draft/publish lifecycle. A stored value that no longer passes a rule tightened
since it was saved now stops a status-only publish, with a validation error on
that field. Fix the field, then publish. Sending `published` again to a document
that is already live is not re-validated. For a collection entry, publishing
validates the stored row's own fields and translations, as publishing a draft
already did: a required field-group (component) value or relationship missing
from storage is not re-checked at publish.

The page builder's composition check also refuses a new loop in a document
that already holds one, re-judges the documents placing a component when an
exposure is removed or a slot is re-aimed at another node, and counts every
composition a save performs against that save's one work limit.
