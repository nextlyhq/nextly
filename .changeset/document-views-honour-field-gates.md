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

A field-type document view, such as the Page Builder's screen, now opens only for a field the edit form would let the author edit. Opened at its address for a field that is read-only, disabled, hidden, or hidden by its condition (its own, or an unnamed group's around it), the admin says why and offers the way back to the document, instead of drawing an editor that could save into the field.

Where a document has several such fields and the address names none, the admin offers only the ones the author may edit, and opens the only one directly.

The form also no longer draws a field marked `admin.hidden` that has its own editor (`admin.component`). Before, only fields drawn through the standard wrapper were hidden.

The Page Builder's screen also starts afresh when its address moves to another blocks field of the same document. Before, it kept showing the first field's page and could save it into the second.
