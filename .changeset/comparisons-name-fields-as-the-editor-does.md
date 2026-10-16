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
---

A version comparison now names fields the way the editor does. Each field
carries the label it declares (`declaredLabel`, or `null` when it declares
none, so a reader applies its own naming rule instead of showing the field's
key) and its place among containers (`path`), including groups with no name,
whose heading was lost before. A field the reader may not read is reported in
its place as `hidden`, with nothing of its values, instead of disappearing.
Keys with no field are marked `system` (a framework column such as when the
document was first published) or `removed`, and removed fields are listed
last. A comparison with withheld fields is marked `incomplete`, so "no
changes" then means only that nothing the reader may read changed; a
changes-only comparison never lists a hidden field. The new response fields
are experimental.

Compatibility: `FieldDiff` gains the `hidden` member. Code that switches over
`kind` exhaustively needs a `hidden` case (or a default) after upgrading; the
admin draws it as "Hidden: you don't have access to this field".
